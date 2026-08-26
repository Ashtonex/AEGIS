"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderKanban,
  Loader2,
  MessageSquare,
  Save,
  ShieldCheck,
} from "lucide-react";

import {
  ApiError,
  ClientPaymentRequest,
  ClientPortalProject,
  ClientPortalTicket,
  ClientPortalWorkspace,
  ClientProjectDetail,
  ClientProjectVariation,
  PortalCommunicationMessage,
  clearClientPortalPaymentRequest,
  createClientPortalAdditionalRequest,
  createClientPortalIssue,
  createClientPortalMessage,
  createClientPortalTicket,
  createClientPortalVariation,
  getClientPortalProjectDetail,
  getClientPortalDocumentSignedUrl,
  getClientPortalProjects,
  getClientPortalWorkspace,
  registerClientPortalDocument,
  updateClientPortalProfile,
} from "@/lib/api";
import { PortalDocumentUpload, type UploadedDocumentResult } from "@/components/portal/PortalDocumentUpload";
import { usePortalTour } from "@/hooks/usePortalTour";
import { ModuleTour, type ModuleTourStep } from "@/components/onboarding/ModuleTour";

type EvidenceDocument = {
  id: string;
  title: string;
  category: string;
  created_at: string;
};

const CLIENT_TOUR_STEPS: ModuleTourStep[] = [
  {
    title: "Welcome to your AEGIS client portal",
    body: "Everything about your project - progress, issues, changes, and payments - lives here so you never have to chase anyone by email.",
    placement: "center",
  },
  {
    title: "Pick a project",
    body: "If you have more than one project with AEGIS, switch between them here. Everything below updates to match.",
    target: "client-project-selector",
    placement: "bottom",
  },
  {
    title: "Payment requests",
    body: "AEGIS sends payment requests here. Once you've paid, mark it cleared and attach your receipt - or AEGIS Finance will mark it cleared with theirs.",
    target: "client-payment-requests",
    placement: "top",
  },
  {
    title: "Variation requests",
    body: "Need a change to the scope? Submit it here with an estimated cost and time impact, and track its approval status.",
    target: "client-variations",
    placement: "top",
  },
  {
    title: "Issues & requests",
    body: "Spotted a problem on site, or need something extra? Raise it here and it goes straight to the project team.",
    target: "client-issues",
    placement: "top",
  },
  {
    title: "Direct messages",
    body: "For anything else, send a message here and the AEGIS team will reply directly in this thread.",
    target: "client-messages",
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

export function ClientPortalHome() {
  const [workspace, setWorkspace] = useState<ClientPortalWorkspace | null>(null);
  const [tickets, setTickets] = useState<ClientPortalTicket[]>([]);
  const [messages, setMessages] = useState<PortalCommunicationMessage[]>([]);
  const [projects, setProjects] = useState<ClientPortalProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectDetail, setProjectDetail] = useState<ClientProjectDetail | null>(null);
  const tour = usePortalTour("client_portal");

  const [loading, setLoading] = useState(true);
  const [loadingProject, setLoadingProject] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);

  const [messageText, setMessageText] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [issueForm, setIssueForm] = useState({ subject: "", description: "" });
  const [requestForm, setRequestForm] = useState({ subject: "", description: "" });
  const [variationForm, setVariationForm] = useState({ title: "", description: "", cost_impact: "", time_impact_days: "" });
  const [issueEvidence, setIssueEvidence] = useState<EvidenceDocument[]>([]);
  const [requestEvidence, setRequestEvidence] = useState<EvidenceDocument[]>([]);
  const [variationEvidence, setVariationEvidence] = useState<EvidenceDocument[]>([]);
  const [profileForm, setProfileForm] = useState({
    company_name: "",
    company_email: "",
    company_phone: "",
    company_address: "",
    contact_name: "",
    email: "",
    phone: "",
    job_title: "",
    whatsapp_preference: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wsRes, projectRes] = await Promise.allSettled([getClientPortalWorkspace(), getClientPortalProjects()]);
      if (wsRes.status === "fulfilled" && wsRes.value.data) {
        const data = wsRes.value.data;
        setWorkspace(data);
        setTickets(data.tickets ?? []);
        setMessages(data.messages ?? []);
        setProfileForm({
          company_name: data.client.company_name ?? "",
          company_email: data.client.company_email ?? "",
          company_phone: data.client.company_phone ?? "",
          company_address: data.client.company_address ?? "",
          contact_name: data.client.contact_name ?? "",
          email: data.client.email ?? "",
          phone: data.client.phone ?? "",
          job_title: data.client.job_title ?? "",
          whatsapp_preference: Boolean(data.client.whatsapp_preference),
        });
      } else {
        setError("The client portal workspace could not be loaded.");
      }
      if (projectRes.status === "fulfilled") {
        const list = projectRes.value.data ?? [];
        setProjects(list);
        setSelectedProjectId((current) => current || list[0]?.id || "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjectDetail = useCallback(async (projectId: string) => {
    if (!projectId) {
      setProjectDetail(null);
      return;
    }
    setLoadingProject(true);
    try {
      const res = await getClientPortalProjectDetail(projectId);
      setProjectDetail(res.data ?? null);
    } catch {
      setProjectDetail(null);
    } finally {
      setLoadingProject(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadProjectDetail(selectedProjectId);
  }, [selectedProjectId, loadProjectDetail]);

  const activeModules = useMemo(
    () => workspace?.modules.filter((m) => m.status === "active").length ?? 0,
    [workspace]
  );
  const openPaymentRequests = useMemo(
    () => (projectDetail?.payment_requests ?? []).filter((p) => p.status === "sent" || p.status === "viewed"),
    [projectDetail]
  );

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = messageText.trim();
    if (body.length < 2) {
      setError("Please enter a message before sending.");
      return;
    }
    setSaving("message");
    setError(null);
    setNotice(null);
    try {
      const response = await createClientPortalMessage({ subject: messageSubject.trim() || "Client portal message", body });
      if (response.data) setMessages((c) => [response.data as PortalCommunicationMessage, ...c]);
      setMessageSubject("");
      setMessageText("");
      setNotice("Message sent.");
    } catch (err) {
      setError(actionMessage(err, "The message could not be sent."));
    } finally {
      setSaving(null);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileForm.company_name.trim() || !profileForm.contact_name.trim()) {
      setError("Company name and primary contact are required.");
      return;
    }
    setSaving("profile");
    setError(null);
    setNotice(null);
    try {
      await updateClientPortalProfile(profileForm);
      setNotice("Company and contact details saved.");
      await load();
    } catch (err) {
      setError(actionMessage(err, "Company details could not be saved."));
    } finally {
      setSaving(null);
    }
  }

  async function uploadEvidence(result: UploadedDocumentResult, target: "issue" | "request" | "variation") {
    setSaving(`evidence-${target}`);
    setError(null);
    setNotice(null);
    try {
      const response = await registerClientPortalDocument({ ...result, category: "evidence" });
      if (!response.data?.id) throw new Error("The evidence file could not be registered.");
      const document = response.data as EvidenceDocument;
      if (target === "issue") setIssueEvidence((current) => [...current, document]);
      if (target === "request") setRequestEvidence((current) => [...current, document]);
      if (target === "variation") setVariationEvidence((current) => [...current, document]);
      setNotice("Evidence uploaded.");
    } catch (err) {
      setError(actionMessage(err, "Evidence could not be uploaded."));
    } finally {
      setSaving(null);
    }
  }

  async function uploadClientDocument(result: UploadedDocumentResult) {
    setSaving("client-document");
    setError(null);
    setNotice(null);
    try {
      await registerClientPortalDocument({ ...result, category: "client_document" });
      setNotice("Document uploaded.");
      await load();
    } catch (err) {
      setError(actionMessage(err, "Document could not be uploaded."));
    } finally {
      setSaving(null);
    }
  }

  async function viewClientDocument(documentId: string) {
    setError(null);
    try {
      const res = await getClientPortalDocumentSignedUrl(documentId);
      if (res.data?.url) window.open(res.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(actionMessage(err, "Document could not be opened."));
    }
  }

  async function submitGeneralTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = requestForm.description.trim();
    if (cleaned.length < 10) {
      setError("Please describe the request in at least 10 characters.");
      return;
    }
    setSaving("general-ticket");
    setError(null);
    setNotice(null);
    try {
      const response = await createClientPortalTicket(cleaned);
      if (response.data) setTickets((c) => [response.data as ClientPortalTicket, ...c]);
      setRequestForm({ subject: "", description: "" });
      setNotice("Request submitted to the AEGIS team.");
    } catch (err) {
      setError(actionMessage(err, "The request could not be submitted."));
    } finally {
      setSaving(null);
    }
  }

  async function submitIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || issueForm.description.trim().length < 10) {
      setError("Select a project and describe the issue in at least 10 characters.");
      return;
    }
    setSaving("issue");
    setError(null);
    setNotice(null);
    try {
      await createClientPortalIssue({
        project_id: selectedProjectId,
        subject: issueForm.subject || "Project issue",
        description: issueForm.description,
        evidence_document_ids: issueEvidence.map((doc) => doc.id),
      });
      setNotice("Issue raised.");
      setIssueForm({ subject: "", description: "" });
      setIssueEvidence([]);
      await loadProjectDetail(selectedProjectId);
    } catch (err) {
      setError(actionMessage(err, "The issue could not be raised."));
    } finally {
      setSaving(null);
    }
  }

  async function submitAdditionalRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || requestForm.description.trim().length < 10) {
      setError("Select a project and describe the request in at least 10 characters.");
      return;
    }
    setSaving("additional-request");
    setError(null);
    setNotice(null);
    try {
      await createClientPortalAdditionalRequest({
        project_id: selectedProjectId,
        subject: requestForm.subject || "Additional request",
        description: requestForm.description,
        evidence_document_ids: requestEvidence.map((doc) => doc.id),
      });
      setNotice("Request submitted.");
      setRequestForm({ subject: "", description: "" });
      setRequestEvidence([]);
      await loadProjectDetail(selectedProjectId);
    } catch (err) {
      setError(actionMessage(err, "The request could not be submitted."));
    } finally {
      setSaving(null);
    }
  }

  async function submitVariation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || !variationForm.title.trim()) {
      setError("Select a project and provide a variation title.");
      return;
    }
    setSaving("variation");
    setError(null);
    setNotice(null);
    try {
      await createClientPortalVariation({
        project_id: selectedProjectId,
        title: variationForm.title,
        description: variationForm.description || undefined,
        cost_impact: variationForm.cost_impact ? Number(variationForm.cost_impact) : undefined,
        time_impact_days: variationForm.time_impact_days ? Number(variationForm.time_impact_days) : undefined,
        evidence_document_ids: variationEvidence.map((doc) => doc.id),
      });
      setNotice("Variation submitted for review.");
      setVariationForm({ title: "", description: "", cost_impact: "", time_impact_days: "" });
      setVariationEvidence([]);
      await loadProjectDetail(selectedProjectId);
    } catch (err) {
      setError(actionMessage(err, "The variation could not be submitted."));
    } finally {
      setSaving(null);
    }
  }

  async function handleReceiptUpload(result: UploadedDocumentResult, requestId: string) {
    setSaving(`clear-${requestId}`);
    setError(null);
    setNotice(null);
    try {
      const doc = await registerClientPortalDocument({ ...result, category: "receipt" });
      if (!doc.data?.id) throw new Error("The receipt could not be registered.");
      await clearClientPortalPaymentRequest(requestId, doc.data.id);
      setNotice("Payment marked as cleared.");
      setClearingId(null);
      await loadProjectDetail(selectedProjectId);
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

  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="border-b border-ink-mid bg-ink-light">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[10px] tracking-widest text-signal uppercase">AEGIS client workspace</p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">Client Portal</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-light">
              See every project, raise issues, request variations, and manage payments - all in one place.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Projects</p>
              <p className="text-2xl font-semibold">{projects.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Tickets</p>
              <p className="text-2xl font-semibold">{tickets.length}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Modules</p>
              <p className="text-2xl font-semibold">{activeModules}</p>
            </div>
            <div className="border border-ink-mid bg-ink px-4 py-3">
              <p className="font-mono text-[10px] text-slate-light uppercase">Access</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-green-400">
                <ShieldCheck className="h-4 w-4" /> Verified
              </p>
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

        <div className="mb-6 border border-ink-mid bg-ink-light p-4" data-tour="client-project-selector">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Project</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="mt-2 h-11 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal md:max-w-md"
            >
              {projects.length === 0 && <option value="">No projects linked yet</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.project_code ? `(${p.project_code})` : ""}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {loadingProject ? (
              <div className="flex h-32 items-center justify-center border border-ink-mid bg-ink-light">
                <Loader2 className="h-5 w-5 animate-spin text-signal" />
              </div>
            ) : !projectDetail ? (
              <div className="border border-ink-mid bg-ink-light p-8 text-center text-sm text-slate-light">
                Select a project to see its issues, variations, and payment requests.
              </div>
            ) : (
              <>
                <div className="border border-ink-mid bg-ink-light" data-tour="client-payment-requests">
                  <div className="flex items-center justify-between border-b border-ink-mid p-4">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Commercial</p>
                      <h2 className="mt-1 text-xl font-semibold">Payment requests</h2>
                    </div>
                    <Banknote className="h-5 w-5 text-slate-light" />
                  </div>
                  {projectDetail.payment_requests.length === 0 ? (
                    <p className="p-6 text-sm text-slate-light">No payment requests for this project yet.</p>
                  ) : (
                    <div className="divide-y divide-ink-mid">
                      {projectDetail.payment_requests.map((req: ClientPaymentRequest) => (
                        <div key={req.id} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{req.title}</p>
                              {req.description && <p className="mt-1 text-xs text-slate-light">{req.description}</p>}
                            </div>
                            <span className="shrink-0 font-mono text-sm">{money(req.amount, req.currency)}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className={`font-mono text-[10px] uppercase ${req.status === "cleared" ? "text-emerald-400" : "text-slate-light"}`}>
                              {req.status} {req.due_date ? `· due ${formatDate(req.due_date)}` : ""}
                            </span>
                            {req.status === "sent" || req.status === "viewed" ? (
                              clearingId === req.id ? (
                                <div className="w-40">
                                  <PortalDocumentUpload
                                    label="Attach receipt"
                                    onUploaded={(r) => handleReceiptUpload(r, req.id)}
                                    disabled={saving === `clear-${req.id}`}
                                  />
                                </div>
                              ) : (
                                <button type="button" onClick={() => setClearingId(req.id)} className="font-mono text-[10px] uppercase tracking-widest text-signal hover:underline">
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

                <div className="border border-ink-mid bg-ink-light" data-tour="client-variations">
                  <div className="flex items-center justify-between border-b border-ink-mid p-4">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Scope changes</p>
                      <h2 className="mt-1 text-xl font-semibold">Variation requests</h2>
                    </div>
                    <FolderKanban className="h-5 w-5 text-slate-light" />
                  </div>
                  <form onSubmit={submitVariation} className="grid gap-3 border-b border-ink-mid p-4 md:grid-cols-2">
                    <label className="block md:col-span-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Title</span>
                      <input value={variationForm.title} onChange={(e) => setVariationForm((c) => ({ ...c, title: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Description</span>
                      <textarea rows={3} value={variationForm.description} onChange={(e) => setVariationForm((c) => ({ ...c, description: e.target.value }))} className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                    <div className="md:col-span-2">
                      <PortalDocumentUpload
                        label="Attach supporting image or PDF"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onUploaded={(result) => uploadEvidence(result, "variation")}
                        disabled={saving === "evidence-variation"}
                      />
                      {variationEvidence.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {variationEvidence.map((doc) => (
                            <span key={doc.id} className="border border-ink-mid bg-ink px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                              {doc.title}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <label className="block">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Estimated cost impact</span>
                      <input type="number" step="0.01" value={variationForm.cost_impact} onChange={(e) => setVariationForm((c) => ({ ...c, cost_impact: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                    <label className="block">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Time impact (days)</span>
                      <input type="number" value={variationForm.time_impact_days} onChange={(e) => setVariationForm((c) => ({ ...c, time_impact_days: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                    </label>
                    <div className="md:col-span-2">
                      <button type="submit" disabled={saving === "variation"} className="inline-flex h-10 items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                        {saving === "variation" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderKanban className="h-4 w-4" />}
                        Submit variation
                      </button>
                    </div>
                  </form>
                  {projectDetail.variations.length === 0 ? (
                    <p className="p-6 text-sm text-slate-light">No variations submitted for this project yet.</p>
                  ) : (
                    <div className="divide-y divide-ink-mid">
                      {projectDetail.variations.map((v: ClientProjectVariation) => (
                        <div key={v.id} className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium">{v.title}</p>
                            {v.cost_impact != null && <span className="shrink-0 font-mono text-sm">{money(v.cost_impact, "USD")}</span>}
                          </div>
                          <p className="mt-1 font-mono text-[10px] uppercase text-slate-light">
                            {v.variation_number} · {v.status}
                            {v.time_impact_days ? ` · ${v.time_impact_days}d` : ""}
                          </p>
                          {v.status === "rejected" && v.rejection_reason && (
                            <p className="mt-2 text-xs italic text-red-300">&quot;{v.rejection_reason}&quot;</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-6 md:grid-cols-2" data-tour="client-issues">
                  <form onSubmit={submitIssue} className="border border-ink-mid bg-ink-light">
                    <div className="border-b border-ink-mid p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Raise an issue</p>
                      <h2 className="mt-1 text-lg font-semibold">Report a problem</h2>
                    </div>
                    <div className="space-y-3 p-4">
                      <input value={issueForm.subject} onChange={(e) => setIssueForm((c) => ({ ...c, subject: e.target.value }))} placeholder="Subject" className="h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                      <textarea rows={4} value={issueForm.description} onChange={(e) => setIssueForm((c) => ({ ...c, description: e.target.value }))} placeholder="Describe the issue..." className="w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                      <PortalDocumentUpload
                        label="Attach photo or PDF evidence"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onUploaded={(result) => uploadEvidence(result, "issue")}
                        disabled={saving === "evidence-issue"}
                      />
                      {issueEvidence.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {issueEvidence.map((doc) => (
                            <span key={doc.id} className="border border-ink-mid bg-ink px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                              {doc.title}
                            </span>
                          ))}
                        </div>
                      )}
                      <button type="submit" disabled={saving === "issue"} className="inline-flex h-10 w-full items-center justify-center gap-2 border border-ink-mid px-4 font-mono text-xs uppercase tracking-widest hover:border-signal disabled:opacity-50">
                        {saving === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Raise issue"}
                      </button>
                    </div>
                  </form>

                  <form onSubmit={submitAdditionalRequest} className="border border-ink-mid bg-ink-light">
                    <div className="border-b border-ink-mid p-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Additional request</p>
                      <h2 className="mt-1 text-lg font-semibold">Ask for something extra</h2>
                    </div>
                    <div className="space-y-3 p-4">
                      <input value={requestForm.subject} onChange={(e) => setRequestForm((c) => ({ ...c, subject: e.target.value }))} placeholder="Subject" className="h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                      <textarea rows={4} value={requestForm.description} onChange={(e) => setRequestForm((c) => ({ ...c, description: e.target.value }))} placeholder="Describe the request..." className="w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                      <PortalDocumentUpload
                        label="Attach supporting image or PDF"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onUploaded={(result) => uploadEvidence(result, "request")}
                        disabled={saving === "evidence-request"}
                      />
                      {requestEvidence.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {requestEvidence.map((doc) => (
                            <span key={doc.id} className="border border-ink-mid bg-ink px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                              {doc.title}
                            </span>
                          ))}
                        </div>
                      )}
                      <button type="submit" disabled={saving === "additional-request"} className="inline-flex h-10 w-full items-center justify-center gap-2 border border-ink-mid px-4 font-mono text-xs uppercase tracking-widest hover:border-signal disabled:opacity-50">
                        {saving === "additional-request" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit request"}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>

          <aside className="space-y-6">
            <div className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Documents</p>
                  <h2 className="mt-1 text-xl font-semibold">Your files</h2>
                </div>
                <FileText className="h-5 w-5 text-slate-light" />
              </div>
              <div className="border-b border-ink-mid p-4">
                <PortalDocumentUpload
                  label="Upload updated document"
                  onUploaded={uploadClientDocument}
                  disabled={saving === "client-document"}
                />
              </div>
              {(workspace?.documents ?? []).length === 0 ? (
                <p className="p-4 text-sm text-slate-light">No documents uploaded yet.</p>
              ) : (
                <div className="max-h-80 divide-y divide-ink-mid overflow-y-auto">
                  {(workspace?.documents ?? []).map((doc) => (
                    <div key={doc.id} className="p-4">
                      <p className="truncate text-sm font-medium">{doc.file_name || doc.title}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase text-slate-light">
                        {doc.category.replaceAll("_", " ")} · {formatDate(doc.created_at)}
                      </p>
                      <button
                        type="button"
                        onClick={() => void viewClientDocument(doc.id)}
                        className="mt-3 inline-flex h-8 items-center gap-2 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={saveProfile} className="border border-ink-mid bg-ink-light">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Company details</p>
                  <h2 className="mt-1 text-xl font-semibold">Your profile</h2>
                </div>
                <Building2 className="h-5 w-5 text-slate-light" />
              </div>
              <div className="grid gap-3 p-4">
                {([
                  ["company_name", "Company name"],
                  ["company_email", "Company email"],
                  ["company_phone", "Company phone"],
                  ["contact_name", "Primary contact"],
                  ["job_title", "Role / title"],
                  ["email", "Contact email"],
                  ["phone", "Contact phone"],
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
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Company address</span>
                  <textarea
                    rows={2}
                    value={profileForm.company_address}
                    onChange={(e) => setProfileForm((c) => ({ ...c, company_address: e.target.value }))}
                    className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal"
                  />
                </label>
                <label className="flex items-start gap-2 border border-ink-mid bg-ink p-3 text-sm text-slate-light">
                  <input
                    type="checkbox"
                    checked={profileForm.whatsapp_preference}
                    onChange={(e) => setProfileForm((c) => ({ ...c, whatsapp_preference: e.target.checked }))}
                    className="mt-1"
                  />
                  <span>Prefer WhatsApp or phone follow-up when AEGIS needs a quick response.</span>
                </label>
              </div>
              <div className="border-t border-ink-mid p-4">
                <button type="submit" disabled={saving === "profile"} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                  {saving === "profile" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save details
                </button>
              </div>
            </form>

            <div className="border border-ink-mid bg-ink-light" data-tour="client-messages">
              <div className="flex items-center justify-between border-b border-ink-mid p-4">
                <div>
                  <p className="font-mono text-[10px] tracking-widest text-signal uppercase">Communication</p>
                  <h2 className="mt-1 text-lg font-semibold">Messages</h2>
                </div>
                <MessageSquare className="h-5 w-5 text-slate-light" />
              </div>
              {messages.length === 0 ? (
                <p className="p-6 text-sm text-slate-light">No messages yet.</p>
              ) : (
                <div className="max-h-72 divide-y divide-ink-mid overflow-y-auto">
                  {messages.slice(0, 10).map((message) => (
                    <article key={message.id} className="p-4">
                      <p className="text-sm font-semibold">{message.subject || "Portal message"}</p>
                      <p className="mt-1 text-sm text-slate-light">{message.body || "No message body recorded."}</p>
                      <p className="mt-2 font-mono text-[10px] text-slate">{formatDate(message.started_at || message.created_at)}</p>
                    </article>
                  ))}
                </div>
              )}
              <form onSubmit={submitMessage} className="space-y-2 border-t border-ink-mid p-4">
                <input value={messageSubject} onChange={(e) => setMessageSubject(e.target.value)} placeholder="Subject" className="h-9 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
                <textarea rows={3} value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Send a message..." className="w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
                <button type="submit" disabled={saving === "message"} className="inline-flex h-9 w-full items-center justify-center gap-2 bg-signal font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
                  {saving === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
                </button>
              </form>
            </div>

            <form onSubmit={submitGeneralTicket} className="border border-ink-mid bg-ink-light p-5">
              <div className="mb-3 flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-slate-light" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate-light">General contact (not project-specific)</p>
              </div>
              <textarea rows={4} value={requestForm.description} onChange={(e) => setRequestForm((c) => ({ ...c, description: e.target.value }))} placeholder="Anything else the AEGIS team should know..." className="w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
              <button type="submit" disabled={saving === "general-ticket"} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 border border-ink-mid font-mono text-xs uppercase tracking-widest hover:border-signal disabled:opacity-50">
                {saving === "general-ticket" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
              </button>
            </form>
          </aside>
        </div>
      </section>

      <ModuleTour steps={CLIENT_TOUR_STEPS} open={tour.open} onClose={tour.closeTour} onComplete={tour.completeTour} />
    </main>
  );
}
