"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  ClipboardList,
  FileText,
  Loader2,
  Package,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserCog,
} from "lucide-react";

import {
  ApiError,
  SupplierPortalWorkspace,
  SupplierPortalRfq,
  VendorPaymentRequest,
  VendorRateItem,
  VendorRateType,
  clearSupplierPortalPaymentRequest,
  createSupplierPortalPaymentRequest,
  createSupplierPortalRateItem,
  getSupplierPortalPaymentRequests,
  getSupplierPortalDocumentSignedUrl,
  getSupplierPortalRateItems,
  getSupplierPortalRfqs,
  getSupplierPortalWorkspace,
  registerSupplierPortalDocument,
  submitSupplierPortalRfqResponse,
  submitSupplierPortalProfileForReview,
  updateSupplierPortalProfile,
  type SupplierComplianceDocumentType,
} from "@/lib/api";
import { PortalDocumentUpload, type UploadedDocumentResult } from "@/components/portal/PortalDocumentUpload";
import { usePortalTour } from "@/hooks/usePortalTour";
import { ModuleTour, type ModuleTourStep } from "@/components/onboarding/ModuleTour";

const SUPPLIER_TOUR_STEPS: ModuleTourStep[] = [
  {
    title: "Welcome to your AEGIS workspace",
    body: "This is where you manage your profile, compliance documents, pricing, and payment requests with AEGIS - all in one place.",
    placement: "center",
  },
  {
    title: "Get verified",
    body: "Complete your company profile below, then submit it for review. AEGIS runs an automated check first, then HR does a final human review.",
    target: "supplier-verification",
    placement: "bottom",
  },
  {
    title: "Your details",
    body: "Keep your registration, tax, and contact details up to date here. Any change re-triggers verification.",
    target: "supplier-profile",
    placement: "top",
  },
  {
    title: "Compliance documents",
    body: "Upload your tax clearance, NSSA, PRAZ, VAT, and company registration documents here - these are required before you can be verified.",
    target: "supplier-documents",
    placement: "top",
  },
  {
    title: "Your pricing",
    body: "List the materials, transport, or services you offer with your prices. AEGIS staff can browse this when sourcing.",
    target: "supplier-rates",
    placement: "top",
  },
  {
    title: "Get paid",
    body: "Once you're verified, request payment for completed work here. Either you or AEGIS Finance can mark it cleared - just attach a receipt.",
    target: "supplier-payments",
    placement: "left",
  },
];

function actionMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

function formatDate(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "2-digit" });
}

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const VERIFICATION_COPY: Record<string, { label: string; tone: string; icon: ReactNode; body: string }> = {
  incomplete: {
    label: "Profile incomplete",
    tone: "border-amber-500/40 bg-amber-950/20 text-amber-200",
    icon: <ShieldAlert className="h-5 w-5" />,
    body: "Complete your company profile and upload your compliance documents, then submit for review.",
  },
  system_pending: {
    label: "Not yet ready for review",
    tone: "border-amber-500/40 bg-amber-950/20 text-amber-200",
    icon: <ShieldAlert className="h-5 w-5" />,
    body: "Automated checks found gaps in your profile or documents - see the details below.",
  },
  system_verified: {
    label: "Awaiting HR review",
    tone: "border-blue-500/40 bg-blue-950/20 text-blue-200",
    icon: <Clock className="h-5 w-5" />,
    body: "Automated checks passed. AEGIS HR will verify your profile shortly.",
  },
  hr_verified: {
    label: "Verified",
    tone: "border-emerald-500/40 bg-emerald-950/20 text-emerald-200",
    icon: <ShieldCheck className="h-5 w-5" />,
    body: "Your profile is fully verified. You can now submit payment requests.",
  },
  rejected: {
    label: "Verification rejected",
    tone: "border-red-500/40 bg-red-950/20 text-red-200",
    icon: <ShieldAlert className="h-5 w-5" />,
    body: "HR rejected this profile. Review the notes below, update your details, and resubmit.",
  },
};

const RATE_TYPE_LABEL: Record<VendorRateType, string> = {
  material: "Material",
  transport: "Transport",
  service: "Service",
};

type QuoteDocument = {
  id: string;
  title: string;
  category: string;
  created_at: string;
};

const SUPPLIER_REQUIRED_DOCUMENTS: Array<{ key: SupplierComplianceDocumentType; label: string }> = [
  { key: "tax_clearance", label: "Tax Clearance" },
  { key: "nssa", label: "NSSA" },
  { key: "praz", label: "PRAZ" },
  { key: "vat", label: "VAT" },
  { key: "company_registration", label: "Company Registration" },
];

type RfqResponseForm = {
  reference: string;
  delivery_days: string;
  validity_days: string;
  notes: string;
  prices: Record<string, string>;
};

export function SupplierPortalHome() {
  const [workspace, setWorkspace] = useState<SupplierPortalWorkspace | null>(null);
  const [rateItems, setRateItems] = useState<VendorRateItem[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<VendorPaymentRequest[]>([]);
  const [rfqs, setRfqs] = useState<SupplierPortalRfq[]>([]);
  const [rfqForms, setRfqForms] = useState<Record<string, RfqResponseForm>>({});
  const [rfqQuoteDocuments, setRfqQuoteDocuments] = useState<Record<string, QuoteDocument>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewProblems, setReviewProblems] = useState<string[]>([]);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const tour = usePortalTour("supplier_portal");

  const [profileForm, setProfileForm] = useState({
    name: "", registration_number: "", tax_clearance_number: "", nssa_number: "", praz_number: "",
    contact_name: "", contact_email: "", contact_phone: "", address: "",
    preferred_contact_method: "email", alternate_contact_name: "", alternate_contact_email: "",
    alternate_contact_phone: "", accounts_contact_email: "", accounts_contact_phone: "",
  });
  const [rateForm, setRateForm] = useState({
    rate_type: "material" as VendorRateType, item_code: "", description: "", unit_of_measure: "each",
    unit_price: "", currency: "USD", min_quantity: "", lead_time_days: "", route_from: "", route_to: "",
  });
  const [paymentForm, setPaymentForm] = useState({ reference_description: "", amount: "", currency: "USD" });

  const accountType = workspace?.vendor.account_type === "subcontractor" ? "subcontractor" : "supplier";
  const isVerified = workspace?.vendor.verification_stage === "hr_verified";

  useEffect(() => {
    if (accountType === "subcontractor") {
      setRateForm((c) => (c.rate_type === "service" ? c : { ...c, rate_type: "service" }));
    } else {
      setRateForm((c) => (c.rate_type === "service" ? { ...c, rate_type: "material" } : c));
    }
  }, [accountType]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wsRes, rateRes, paymentRes, rfqRes] = await Promise.allSettled([
        getSupplierPortalWorkspace(),
        getSupplierPortalRateItems(),
        getSupplierPortalPaymentRequests(),
        getSupplierPortalRfqs(),
      ]);
      if (wsRes.status === "fulfilled" && wsRes.value.data) {
        const vendor = wsRes.value.data.vendor;
        setWorkspace(wsRes.value.data);
        setProfileForm({
          name: vendor.name ?? "", registration_number: vendor.registration_number ?? "",
          tax_clearance_number: vendor.tax_clearance_number ?? "", nssa_number: vendor.nssa_number ?? "",
          praz_number: vendor.praz_number ?? "", contact_name: vendor.contact_name ?? "",
          contact_email: vendor.contact_email ?? "", contact_phone: vendor.contact_phone ?? "",
          address: vendor.address ?? "",
          preferred_contact_method: vendor.preferred_contact_method ?? "email",
          alternate_contact_name: vendor.alternate_contact_name ?? "",
          alternate_contact_email: vendor.alternate_contact_email ?? "",
          alternate_contact_phone: vendor.alternate_contact_phone ?? "",
          accounts_contact_email: vendor.accounts_contact_email ?? "",
          accounts_contact_phone: vendor.accounts_contact_phone ?? "",
        });
      } else {
        setError("The supplier portal workspace could not be loaded.");
      }
      if (rateRes.status === "fulfilled") setRateItems(rateRes.value.data ?? []);
      if (paymentRes.status === "fulfilled") setPaymentRequests(paymentRes.value.data ?? []);
      if (rfqRes.status === "fulfilled") setRfqs(rfqRes.value.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ratesByType = useMemo(() => {
    const groups: Record<string, VendorRateItem[]> = { material: [], transport: [], service: [] };
    for (const item of rateItems) groups[item.rate_type]?.push(item);
    return groups;
  }, [rateItems]);

  const openPaymentRequests = useMemo(
    () => paymentRequests.filter((p) => p.status === "submitted" || p.status === "acknowledged"),
    [paymentRequests]
  );

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("profile");
    setError(null);
    setNotice(null);
    try {
      await updateSupplierPortalProfile(profileForm);
      setNotice("Profile updated.");
      await load();
    } catch (err) {
      setError(actionMessage(err, "Profile could not be updated."));
    } finally {
      setSaving(null);
    }
  }

  async function submitForReview() {
    setSaving("review");
    setError(null);
    setNotice(null);
    setReviewProblems([]);
    try {
      const res = await submitSupplierPortalProfileForReview();
      if (res.data?.verification_stage === "system_verified") {
        setNotice("Profile passed automated checks and was sent to HR for verification.");
      } else {
        setReviewProblems(res.data?.problems ?? []);
      }
      await load();
    } catch (err) {
      setError(actionMessage(err, "Profile could not be submitted for review."));
    } finally {
      setSaving(null);
    }
  }

  async function handleComplianceUpload(result: UploadedDocumentResult, documentType: SupplierComplianceDocumentType) {
    try {
      await registerSupplierPortalDocument({ ...result, category: documentType, document_type: documentType });
      setNotice("Document uploaded.");
      await load();
    } catch (err) {
      setError(actionMessage(err, "Document could not be registered."));
    }
  }

  async function viewSupplierDocument(documentId: string) {
    setError(null);
    try {
      const res = await getSupplierPortalDocumentSignedUrl(documentId);
      if (res.data?.url) window.open(res.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(actionMessage(err, "Document could not be opened."));
    }
  }

  async function createRateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rateForm.description.trim() || !rateForm.unit_price) {
      setError("Description and unit price are required.");
      return;
    }
    setSaving("rate");
    setError(null);
    setNotice(null);
    try {
      await createSupplierPortalRateItem({
        rate_type: rateForm.rate_type,
        item_code: rateForm.item_code || undefined,
        description: rateForm.description,
        unit_of_measure: rateForm.unit_of_measure || "each",
        unit_price: Number(rateForm.unit_price),
        currency: rateForm.currency,
        min_quantity: rateForm.min_quantity ? Number(rateForm.min_quantity) : undefined,
        lead_time_days: rateForm.lead_time_days ? Number(rateForm.lead_time_days) : undefined,
        route_from: rateForm.route_from || undefined,
        route_to: rateForm.route_to || undefined,
      });
      setNotice("Rate item added.");
      setRateForm((c) => ({ ...c, item_code: "", description: "", unit_price: "" }));
      await load();
    } catch (err) {
      setError(actionMessage(err, "Rate item could not be added."));
    } finally {
      setSaving(null);
    }
  }

  async function handleRfqQuoteUpload(result: UploadedDocumentResult, rfqId: string) {
    setSaving(`rfq-upload-${rfqId}`);
    setError(null);
    setNotice(null);
    try {
      const response = await registerSupplierPortalDocument({ ...result, category: "rfq_quote" });
      if (!response.data?.id) throw new Error("The quote file could not be registered.");
      setRfqQuoteDocuments((current) => ({ ...current, [rfqId]: response.data as QuoteDocument }));
      setNotice("Quote file uploaded.");
    } catch (err) {
      setError(actionMessage(err, "Quote file could not be uploaded."));
    } finally {
      setSaving(null);
    }
  }

  async function submitRfqResponse(rfq: SupplierPortalRfq) {
    const form = rfqForms[rfq.id] ?? { reference: "", delivery_days: "", validity_days: "30", notes: "", prices: {} };
    const lineItems = rfq.requested_items
      .flatMap((item, index) => {
        const key = item.id ?? String(index);
        const rawPrice = form.prices[key]?.trim();
        if (!rawPrice) return [];
        const unitPrice = Number(rawPrice);
        if (!Number.isFinite(unitPrice)) return [];
        return [{
          description: item.description,
          qty: item.qty,
          uom: item.uom,
          unit_price: unitPrice,
          notes: item.notes,
        }];
      });
    const quoteDocument = rfqQuoteDocuments[rfq.id];
    if (lineItems.length === 0 && !quoteDocument) {
      setError("Add at least one line price or upload a formal quotation.");
      return;
    }
    setSaving(`rfq-${rfq.id}`);
    setError(null);
    setNotice(null);
    try {
      await submitSupplierPortalRfqResponse(rfq.id, {
        reference: form.reference || undefined,
        delivery_days: form.delivery_days ? Number(form.delivery_days) : undefined,
        validity_days: form.validity_days ? Number(form.validity_days) : 30,
        notes: form.notes || undefined,
        line_items: lineItems,
        quote_document_id: quoteDocument?.id,
      });
      setNotice("RFQ response submitted.");
      await load();
    } catch (err) {
      setError(actionMessage(err, "RFQ response could not be submitted."));
    } finally {
      setSaving(null);
    }
  }

  async function createPaymentRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentForm.reference_description.trim() || !paymentForm.amount) {
      setError("Description and amount are required.");
      return;
    }
    setSaving("payment");
    setError(null);
    setNotice(null);
    try {
      await createSupplierPortalPaymentRequest({
        reference_description: paymentForm.reference_description,
        amount: Number(paymentForm.amount),
        currency: paymentForm.currency,
      });
      setNotice("Payment request submitted.");
      setPaymentForm({ reference_description: "", amount: "", currency: "USD" });
      await load();
    } catch (err) {
      setError(actionMessage(err, "Payment request could not be submitted."));
    } finally {
      setSaving(null);
    }
  }

  async function handleReceiptUpload(result: UploadedDocumentResult, requestId: string) {
    setSaving(`clear-${requestId}`);
    setError(null);
    setNotice(null);
    try {
      const doc = await registerSupplierPortalDocument({ ...result, category: "receipt" });
      if (!doc.data?.id) throw new Error("The receipt could not be registered.");
      await clearSupplierPortalPaymentRequest(requestId, doc.data.id);
      setNotice("Payment request cleared.");
      setClearingId(null);
      await load();
    } catch (err) {
      setError(actionMessage(err, "Payment request could not be cleared."));
    } finally {
      setSaving(null);
    }
  }

  if (loading && !workspace) {
    return (
      <main className="min-h-screen bg-ink text-paper flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-signal" />
      </main>
    );
  }

  const verification = VERIFICATION_COPY[workspace?.vendor.verification_stage ?? "incomplete"];

  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="border-b border-ink-mid bg-ink-light">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">
              AEGIS {accountType} workspace
            </p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">
              {accountType === "subcontractor" ? "Subcontractor Portal" : "Supplier Portal"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-light">
              Build your profile, upload compliance documents, submit your{" "}
              {accountType === "subcontractor" ? "service rates" : "prices and transport rates"}, and request payment
              once work is cleared.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Documents</p>
              <p className="text-2xl font-semibold">{workspace?.documents.length ?? 0}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Rate items</p>
              <p className="text-2xl font-semibold">{rateItems.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Open requests</p>
              <p className="text-2xl font-semibold">{openPaymentRequests.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Status</p>
              <p className="mt-1 text-xs font-semibold text-paper truncate">{verification.label}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-4 flex gap-3 border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mb-4 flex gap-3 border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <div className={`mb-6 flex flex-col gap-3 border p-4 sm:flex-row sm:items-start ${verification.tone}`} data-tour="supplier-verification">
          {verification.icon}
          <div className="flex-1">
            <p className="font-semibold">{verification.label}</p>
            <p className="mt-1 text-sm opacity-90">{verification.body}</p>
            {workspace?.vendor.hr_verification_notes && workspace.vendor.verification_stage === "rejected" && (
              <p className="mt-2 text-sm italic opacity-90">&quot;{workspace.vendor.hr_verification_notes}&quot;</p>
            )}
            {reviewProblems.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm opacity-90">
                {reviewProblems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => void submitForReview()}
            disabled={saving === "review"}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 border border-current px-4 font-mono text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {saving === "review" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Submit for review
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="space-y-6">
            <form onSubmit={saveProfile} className="border border-ink-mid bg-ink-light" data-tour="supplier-profile">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Company profile</p>
                  <h2 className="mt-1 text-xl font-semibold">Your details</h2>
                </div>
                <UserCog className="h-5 w-5 text-slate-light" />
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {([
                  ["name", "Company name"], ["registration_number", "Registration number"],
                  ["tax_clearance_number", "Tax clearance number"], ["nssa_number", "NSSA number"],
                  ["praz_number", "PRAZ number (optional)"], ["contact_name", "Contact person"],
                  ["contact_email", "Contact email"], ["contact_phone", "Contact phone"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">{label}</span>
                    <input
                      value={profileForm[key]}
                      onChange={(e) => setProfileForm((c) => ({ ...c, [key]: e.target.value }))}
                      className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                    />
                  </label>
                ))}
                <label className="block md:col-span-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Preferred contact method</span>
                  <select
                    value={profileForm.preferred_contact_method}
                    onChange={(e) => setProfileForm((c) => ({ ...c, preferred_contact_method: e.target.value }))}
                    className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                  >
                    <option value="email">Email</option>
                    <option value="phone">Phone call</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="sms">SMS</option>
                  </select>
                </label>
                {([
                  ["alternate_contact_name", "Alternate contact"],
                  ["alternate_contact_email", "Alternate email"],
                  ["alternate_contact_phone", "Alternate phone"],
                  ["accounts_contact_email", "Accounts email"],
                  ["accounts_contact_phone", "Accounts phone"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">{label}</span>
                    <input
                      value={profileForm[key]}
                      onChange={(e) => setProfileForm((c) => ({ ...c, [key]: e.target.value }))}
                      className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                    />
                  </label>
                ))}
                <label className="block md:col-span-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Address</span>
                  <textarea
                    rows={2}
                    value={profileForm.address}
                    onChange={(e) => setProfileForm((c) => ({ ...c, address: e.target.value }))}
                    className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal"
                  />
                </label>
              </div>
              <div className="border-t border-ink-mid p-4">
                <button type="submit" disabled={saving === "profile"} className="inline-flex h-10 items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                  {saving === "profile" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
                  Save profile
                </button>
              </div>
            </form>

            <div className="border border-ink-mid bg-ink-light" data-tour="supplier-documents">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Compliance</p>
                  <h2 className="mt-1 text-xl font-semibold">Documents</h2>
                </div>
                <FileText className="h-5 w-5 text-slate-light" />
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {SUPPLIER_REQUIRED_DOCUMENTS.map((required) => {
                  const doc = workspace?.documents.find((item) => (item.document_type ?? item.category) === required.key);
                  const reviewStatus = doc?.review_status ?? doc?.status ?? "pending_review";
                  return (
                    <div key={required.key} className="border border-ink-mid bg-ink p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-paper">{required.label}</p>
                          <p className="mt-1 truncate text-xs text-slate-light">
                            {doc ? doc.title : "No file uploaded yet."}
                          </p>
                        </div>
                        <span className="shrink-0 border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                          {reviewStatus.replace("_", " ")}
                        </span>
                      </div>
                      {doc?.review_notes && <p className="mt-2 text-xs text-amber-300">{doc.review_notes}</p>}
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <PortalDocumentUpload
                          label={doc ? "Upload updated file" : "Upload file"}
                          onUploaded={(r) => handleComplianceUpload(r, required.key)}
                        />
                        {doc && (
                          <button
                            type="button"
                            onClick={() => void viewSupplierDocument(doc.id)}
                            className="inline-flex items-center justify-center gap-2 border border-ink-mid bg-ink-light px-4 py-3 text-sm text-slate-light hover:border-signal hover:text-paper"
                          >
                            <FileText className="h-4 w-4" />
                            View saved file
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {workspace && workspace.documents.length > 0 && (
                <div className="divide-y divide-ink-mid border-t border-ink-mid">
                  {workspace.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-4 text-sm">
                      <div>
                        <p className="font-medium">{doc.title}</p>
                        <p className="font-mono text-[10px] uppercase text-slate-light">{doc.category.replaceAll("_", " ")}</p>
                      </div>
                      <span className="font-mono text-[10px] text-slate-light">{formatDate(doc.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Requests from AEGIS</p>
                  <h2 className="mt-1 text-xl font-semibold">RFQs and requested materials</h2>
                </div>
                <ClipboardList className="h-5 w-5 text-slate-light" />
              </div>
              {rfqs.length === 0 ? (
                <p className="p-6 text-sm text-slate-light">No issued RFQs are available for response right now.</p>
              ) : (
                <div className="divide-y divide-ink-mid">
                  {rfqs.map((rfq) => {
                    const form = rfqForms[rfq.id] ?? { reference: "", delivery_days: "", validity_days: "30", notes: "", prices: {} };
                    const quoteDocument = rfqQuoteDocuments[rfq.id];
                    return (
                      <article key={rfq.id} className="p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">{rfq.rfq_number}</p>
                            <h3 className="mt-1 text-lg font-semibold">{rfq.title}</h3>
                            <p className="mt-1 text-sm text-slate-light">{rfq.description || "No description supplied."}</p>
                            <p className="mt-2 font-mono text-[10px] uppercase text-slate-light">
                              {rfq.project_name || "Project not linked"} {rfq.closing_date ? `· closes ${formatDate(rfq.closing_date)}` : ""}
                            </p>
                          </div>
                          {rfq.response ? (
                            <span className="shrink-0 border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 font-mono text-[10px] uppercase text-emerald-300">
                              Submitted · {money(Number(rfq.response.total_amount || 0), "USD")}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-4 space-y-2">
                          {(rfq.requested_items ?? []).length === 0 ? (
                            <p className="text-sm text-slate-light">No line items were attached to this RFQ. Upload a formal quote or add notes below.</p>
                          ) : (
                            (rfq.requested_items ?? []).map((item, index) => {
                              const key = item.id ?? String(index);
                              return (
                                <div key={key} className="grid gap-2 border border-ink-mid bg-ink p-3 md:grid-cols-[1fr_120px_160px] md:items-end">
                                  <div>
                                    <p className="text-sm font-medium">{item.description}</p>
                                    <p className="mt-1 font-mono text-[10px] uppercase text-slate-light">
                                      {item.qty ?? "-"} {item.uom || "units"} {item.work_package ? `· ${item.work_package}` : ""}
                                    </p>
                                  </div>
                                  <label className="block">
                                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Unit price</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={form.prices[key] ?? ""}
                                      onChange={(e) => setRfqForms((current) => ({
                                        ...current,
                                        [rfq.id]: {
                                          ...form,
                                          prices: { ...form.prices, [key]: e.target.value },
                                        },
                                      }))}
                                      className="mt-2 h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
                                    />
                                  </label>
                                  <p className="font-mono text-xs text-slate-light">
                                    Line total{" "}
                                    <span className="text-paper">
                                      {form.prices[key] ? money((item.qty || 1) * Number(form.prices[key]), "USD") : "--"}
                                    </span>
                                  </p>
                                </div>
                              );
                            })
                          )}
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <label className="block">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Quote reference</span>
                            <input
                              value={form.reference}
                              onChange={(e) => setRfqForms((current) => ({ ...current, [rfq.id]: { ...form, reference: e.target.value } }))}
                              className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                            />
                          </label>
                          <label className="block">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Delivery days</span>
                            <input
                              type="number"
                              min="1"
                              value={form.delivery_days}
                              onChange={(e) => setRfqForms((current) => ({ ...current, [rfq.id]: { ...form, delivery_days: e.target.value } }))}
                              className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                            />
                          </label>
                          <label className="block">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Validity days</span>
                            <input
                              type="number"
                              min="1"
                              value={form.validity_days}
                              onChange={(e) => setRfqForms((current) => ({ ...current, [rfq.id]: { ...form, validity_days: e.target.value } }))}
                              className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                            />
                          </label>
                          <label className="block md:col-span-3">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Notes / exclusions</span>
                            <textarea
                              rows={2}
                              value={form.notes}
                              onChange={(e) => setRfqForms((current) => ({ ...current, [rfq.id]: { ...form, notes: e.target.value } }))}
                              className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal"
                            />
                          </label>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                          <div>
                            <PortalDocumentUpload
                              label={quoteDocument ? quoteDocument.title : "Upload formal quotation"}
                              accept=".pdf,.xls,.xlsx,.doc,.docx,.png,.jpg,.jpeg"
                              onUploaded={(result) => handleRfqQuoteUpload(result, rfq.id)}
                              disabled={saving === `rfq-upload-${rfq.id}`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => void submitRfqResponse(rfq)}
                            disabled={saving === `rfq-${rfq.id}`}
                            className="inline-flex h-10 items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50"
                          >
                            {saving === `rfq-${rfq.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                            Submit response
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border border-ink-mid bg-ink-light" data-tour="supplier-rates">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Pricing</p>
                  <h2 className="mt-1 text-xl font-semibold">Rate catalog</h2>
                </div>
                <Package className="h-5 w-5 text-slate-light" />
              </div>
              <form onSubmit={createRateItem} className="grid gap-3 border-b border-ink-mid p-4 md:grid-cols-3">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Type</span>
                  <select
                    value={rateForm.rate_type}
                    onChange={(e) => setRateForm((c) => ({ ...c, rate_type: e.target.value as VendorRateType }))}
                    className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                  >
                    {accountType === "subcontractor" ? (
                      <option value="service">Service</option>
                    ) : (
                      <>
                        <option value="material">Material</option>
                        <option value="transport">Transport</option>
                      </>
                    )}
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Description</span>
                  <input
                    value={rateForm.description}
                    onChange={(e) => setRateForm((c) => ({ ...c, description: e.target.value }))}
                    className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
                    placeholder={rateForm.rate_type === "transport" ? "e.g. 30-tonne tipper hire" : "Item or service description"}
                  />
                </label>
                {rateForm.rate_type === "transport" ? (
                  <>
                    <label className="block">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Route from</span>
                      <input value={rateForm.route_from} onChange={(e) => setRateForm((c) => ({ ...c, route_from: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                    <label className="block">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Route to</span>
                      <input value={rateForm.route_to} onChange={(e) => setRateForm((c) => ({ ...c, route_to: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                  </>
                ) : (
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Unit</span>
                    <input value={rateForm.unit_of_measure} onChange={(e) => setRateForm((c) => ({ ...c, unit_of_measure: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                  </label>
                )}
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Unit price (USD)</span>
                  <input type="number" min="0" step="0.01" value={rateForm.unit_price} onChange={(e) => setRateForm((c) => ({ ...c, unit_price: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                </label>
                {rateForm.rate_type === "material" && (
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Lead time (days)</span>
                    <input type="number" min="0" value={rateForm.lead_time_days} onChange={(e) => setRateForm((c) => ({ ...c, lead_time_days: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                  </label>
                )}
                <div className="md:col-span-3">
                  <button type="submit" disabled={saving === "rate"} className="inline-flex h-10 items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                    {saving === "rate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                    Add rate item
                  </button>
                </div>
              </form>
              {rateItems.length === 0 ? (
                <p className="p-6 text-sm text-slate-light">No rate items submitted yet.</p>
              ) : (
                (["material", "transport", "service"] as const).map((type) =>
                  ratesByType[type].length === 0 ? null : (
                    <div key={type}>
                      <p className="border-b border-ink-mid bg-ink px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">
                        {RATE_TYPE_LABEL[type]} ({ratesByType[type].length})
                      </p>
                      <div className="divide-y divide-ink-mid">
                        {ratesByType[type].map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{item.description}</p>
                              <p className="mt-1 truncate font-mono text-[10px] text-slate-light">
                                {item.route_from ? `${item.route_from} -> ${item.route_to}` : item.unit_of_measure}
                              </p>
                            </div>
                            <span className="shrink-0 font-mono text-sm">{money(item.unit_price, item.currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )
              )}
            </div>
          </div>

          <aside className="space-y-6" data-tour="supplier-payments">
            <form onSubmit={createPaymentRequest} className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Payment</p>
                  <h2 className="mt-1 text-xl font-semibold">Request payment</h2>
                </div>
                <Banknote className="h-5 w-5 text-slate-light" />
              </div>
              {!isVerified ? (
                <p className="p-4 text-sm text-amber-200">
                  Your profile must be HR-verified before you can request payment.
                </p>
              ) : (
                <div className="space-y-3 p-4">
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">What is this for?</span>
                    <textarea
                      rows={3}
                      value={paymentForm.reference_description}
                      onChange={(e) => setPaymentForm((c) => ({ ...c, reference_description: e.target.value }))}
                      className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal"
                      placeholder="Describe the work or delivery this payment covers..."
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Amount</span>
                      <input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((c) => ({ ...c, amount: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                    <label className="block">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Currency</span>
                      <input value={paymentForm.currency} onChange={(e) => setPaymentForm((c) => ({ ...c, currency: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                  </div>
                  <button type="submit" disabled={saving === "payment"} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                    {saving === "payment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                    Submit request
                  </button>
                </div>
              )}
            </form>

            <div className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-signal">History</p>
                  <h2 className="mt-1 text-xl font-semibold">Your requests</h2>
                </div>
                <Truck className="h-5 w-5 text-slate-light" />
              </div>
              {paymentRequests.length === 0 ? (
                <p className="p-6 text-sm text-slate-light">No payment requests yet.</p>
              ) : (
                <div className="divide-y divide-ink-mid">
                  {paymentRequests.map((req) => (
                    <div key={req.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm">{req.reference_description}</p>
                        <span className="shrink-0 font-mono text-sm">{money(req.amount, req.currency)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={`font-mono text-[10px] uppercase ${
                            req.status === "cleared" ? "text-emerald-400" : req.status === "cancelled" || req.status === "disputed" ? "text-red-400" : "text-slate-light"
                          }`}
                        >
                          {req.status}
                        </span>
                        {req.status === "submitted" || req.status === "acknowledged" ? (
                          clearingId === req.id ? (
                            <div className="w-40">
                              <PortalDocumentUpload
                                label="Attach receipt"
                                onUploaded={(r) => handleReceiptUpload(r, req.id)}
                                disabled={saving === `clear-${req.id}`}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setClearingId(req.id)}
                              className="font-mono text-[10px] uppercase tracking-widest text-signal hover:underline"
                            >
                              Mark cleared
                            </button>
                          )
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      <ModuleTour steps={SUPPLIER_TOUR_STEPS} open={tour.open} onClose={tour.closeTour} onComplete={tour.completeTour} />
    </main>
  );
}
