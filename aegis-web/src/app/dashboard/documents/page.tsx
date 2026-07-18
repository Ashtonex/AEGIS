"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText, Folder, Loader2, Plus, RefreshCw, Search,
  X, Grid, List, Download, Share2, Upload, History,
  FileCheck, Shield, ChevronRight, CheckCircle2
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  getDocuments,
  getDocument,
  createDocument,
  updateDocumentStatus,
  getDocumentVersions,
  getDocumentLinks,
  getInternalProjects
} from "@/lib/api";

type RecordData = Record<string, any>;

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function sizeValue(bytes: unknown) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function documentFileSize(document: RecordData | null) {
  if (!document) return 0;
  return document.file_size_bytes ?? document.size_bytes ?? 0;
}

function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["approved", "released"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["in_review", "review", "pending"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  if (["superseded"].includes(normalized)) {
    return "border-amber-500/30 bg-amber-950/20 text-amber-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

function classificationClass(classification: string) {
  const normalized = String(classification || "").toLowerCase();
  if (["confidential", "restricted"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  if (["internal"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

function loadFailureMessage(reason: unknown) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  const normalizedMessage = rawMessage.toLowerCase();
  if (
    normalizedMessage.includes("signal is aborted") ||
    normalizedMessage.includes("operation was aborted") ||
    normalizedMessage.includes("aborterror") ||
    normalizedMessage.includes("timeouterror")
  ) {
    return "The document feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Failed to load documents.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

export default function DocumentsDashboard() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Site Agent", "Compliance Officer", "Finance Manager"]}>
      <DocumentsWorkspace />
    </RBACGuard>
  );
}

function DocumentsWorkspace() {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [documents, setDocuments] = useState<RecordData[]>([]);
  const [projects, setProjects] = useState<RecordData[]>([]);

  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [docDetail, setDocDetail] = useState<RecordData | null>(null);
  const [docVersions, setDocVersions] = useState<RecordData[]>([]);
  const [docLinks, setDocLinks] = useState<RecordData[]>([]);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Form Fields
  const [uploadForm, setUploadForm] = useState({ title: "", category: "drawings", classification: "internal", project_id: "", description: "", file_name: "", size_bytes: "" });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docsRes, projRes] = await Promise.allSettled([
        getDocuments({
          category: activeCategory !== "all" ? activeCategory : undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
          classification: classFilter !== "all" ? classFilter : undefined,
          search: searchQuery || undefined,
          project_id: projectFilter !== "all" ? projectFilter : undefined
        }),
        getInternalProjects()
      ]);
      const warnings: string[] = [];
      if (docsRes.status === "fulfilled") setDocuments(docsRes.value.data || []);
      else warnings.push("Document repository could not be loaded.");
      if (projRes.status === "fulfilled") setProjects(projRes.value.data || []);
      else warnings.push("Project register could not be loaded.");
      setSourceWarnings(warnings);
      if (docsRes.status === "rejected") {
        throw new Error(loadFailureMessage(docsRes.reason));
      }
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, [activeCategory, statusFilter, classFilter, searchQuery, projectFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadDocDetail = async (id: string) => {
    setSelectedDocId(id);
    if (!id) {
      setDocDetail(null);
      setDocVersions([]);
      setDocLinks([]);
      return;
    }
    setDetailLoading(true);
    try {
      const [detailRes, versionsRes, linksRes] = await Promise.allSettled([
        getDocument(id),
        getDocumentVersions(id),
        getDocumentLinks(id)
      ]);
      if (detailRes.status === "fulfilled") setDocDetail(detailRes.value.data || null);
      if (versionsRes.status === "fulfilled") setDocVersions(versionsRes.value.data || []);
      if (linksRes.status === "fulfilled") setDocLinks(linksRes.value.data || []);
      if (detailRes.status === "rejected") {
        throw new Error(loadFailureMessage(detailRes.reason));
      }
    } catch (err) {
      setNotice(loadFailureMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadForm.title) return;
    try {
      await createDocument({ ...uploadForm, project_id: uploadForm.project_id || null, file_name: uploadForm.file_name || null, size_bytes: Number(uploadForm.size_bytes || 0) });
      setNotice("Document registered in controlled repository.");
      setShowUploadModal(false);
      setUploadForm({ title: "", category: "drawings", classification: "internal", project_id: "", description: "", file_name: "", size_bytes: "" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to upload document."));
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await updateDocumentStatus(id, newStatus);
      setNotice(`Document status updated to ${newStatus}.`);
      await loadDocDetail(id);
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to update document status."));
    }
  };

  const categories = [
    { key: "all", name: "All Documents" },
    { key: "drawings", name: "Engineering Drawings" },
    { key: "specifications", name: "Project Specifications" },
    { key: "contracts", name: "Contracts & Agreements" },
    { key: "compliance", name: "Compliance & Permits" },
    { key: "reports", name: "Progress & Site Reports" },
    { key: "other", name: "Other Supporting Docs" }
  ];

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Notice Banner */}
      {notice && (
        <div className="bg-ink-light border border-signal/20 px-4 py-3 rounded flex items-center justify-between text-paper text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="font-semibold">Document data could not be loaded.</p>
            <p className="mt-1 text-red-100/80">{error}</p>
          </div>
        </div>
      )}
      {sourceWarnings.length > 0 && (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-paper tracking-tight font-display">Controlled Documents</h1>
          <p className="text-sm text-slate-light font-sans mt-0.5">SNC enterprise document repository, drawings version log, and contract distributions.</p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="p-2 bg-ink-light border border-ink-mid hover:bg-ink-mid/30 text-slate hover:text-paper rounded-sm transition-colors"
          >
            {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center space-x-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
          >
            <Upload className="h-4 w-4" />
            <span>Upload Document</span>
          </button>
        </div>
      </div>

      {/* Main layout grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Category Sidebar */}
        <div className="space-y-2">
          <div className="bg-ink-light border border-ink-mid rounded-sm p-4">
            <h2 className="text-xs font-semibold text-slate font-mono uppercase tracking-wider mb-3">Folders / Categories</h2>
            <div className="space-y-1">
              {categories.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setActiveCategory(c.key)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-xs font-mono uppercase tracking-wider text-left transition-colors ${activeCategory === c.key ? 'bg-signal/10 text-signal border-l-2 border-l-signal font-semibold' : 'text-slate hover:bg-ink-mid/20 hover:text-paper'}`}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Middle Document List / Grid */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search/Filters */}
          <div className="bg-ink-light border border-ink-mid p-4 rounded-sm space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate" />
              <input
                type="text"
                placeholder="Search drawings, specs, agreements, tag codes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-ink border border-ink-mid rounded pl-9 pr-4 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-ink border border-ink-mid rounded px-3 py-1.5 text-xs text-paper focus:outline-none focus:border-signal/50"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="in_review">In Review</option>
                <option value="approved">Approved</option>
                <option value="superseded">Superseded</option>
              </select>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="bg-ink border border-ink-mid rounded px-3 py-1.5 text-xs text-paper focus:outline-none focus:border-signal/50"
              >
                <option value="all">Classifications</option>
                <option value="public">Public</option>
                <option value="internal">Internal Only</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="bg-ink border border-ink-mid rounded px-3 py-1.5 text-xs text-paper focus:outline-none focus:border-signal/50"
              >
                <option value="all">All Projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* List View */}
          {viewMode === "list" ? (
            <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                    <th className="p-4">Doc #</th>
                    <th className="p-4">Title</th>
                    <th className="p-4">Category</th>
                    <th className="p-4">Classification</th>
                    <th className="p-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {documents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate">No documents matched your filters.</td>
                    </tr>
                  ) : (
                    documents.map((d) => (
                      <tr
                        key={d.id}
                        onClick={() => void loadDocDetail(d.id)}
                        className={`cursor-pointer hover:bg-ink-mid/30 transition-colors ${selectedDocId === d.id ? 'bg-ink-mid/20 border-l-2 border-l-signal' : ''}`}
                      >
                        <td className="p-4 font-mono text-signal">{d.doc_number || "Not numbered"}</td>
                        <td className="p-4">
                          <div>
                            <span className="font-medium text-paper">{d.title}</span>
                            <span className="text-[10px] text-slate font-mono block mt-0.5">{d.file_name}</span>
                          </div>
                        </td>
                        <td className="p-4 text-slate-light capitalize">{d.category}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-mono tracking-wider border ${classificationClass(d.classification)}`}>
                            {d.classification || 'internal'}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-mono tracking-wider border ${statusClass(d.status)}`}>
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {documents.length === 0 ? (
                <p className="col-span-2 text-center py-8 text-slate text-sm">No documents matched your filters.</p>
              ) : (
                documents.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => void loadDocDetail(d.id)}
                    className={`bg-ink-light border p-4 rounded-sm cursor-pointer hover:border-signal/50 transition-colors flex flex-col justify-between space-y-4 ${selectedDocId === d.id ? 'border-signal/80 bg-ink-mid/10' : 'border-ink-mid'}`}
                  >
                    <div className="space-y-1">
                      <div className="flex justify-between items-start">
                        <FileText className="h-6 w-6 text-signal" />
                        <span className="text-[10px] font-mono text-slate">{d.doc_number || "Not numbered"}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-paper pt-1">{d.title}</h3>
                      <p className="text-[10px] text-slate-light font-mono truncate">{d.file_name}</p>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-ink-mid/30">
                      <span className={`px-1.5 py-0.5 rounded-sm text-[8px] uppercase font-mono border ${classificationClass(d.classification)}`}>
                        {d.classification || 'internal'}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-sm text-[8px] uppercase font-mono border ${statusClass(d.status)}`}>
                        {d.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Document Detail side panel */}
        <div className="space-y-6">
          <div className="bg-ink-light border border-ink-mid p-5 rounded-sm">
            <h2 className="text-sm font-semibold text-paper tracking-wider uppercase font-mono border-b border-ink-mid pb-3">Document Intelligence</h2>
            {detailLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-signal" />
              </div>
            ) : docDetail ? (
              <div className="space-y-6 mt-4">
                <div>
                  <div className="flex justify-between items-center">
                    <h3 className="text-base font-semibold text-paper">{docDetail.title}</h3>
                    <span className="text-[10px] font-mono text-slate">{docDetail.version ? `v${docDetail.version}` : "Version not recorded"}</span>
                  </div>
                  <p className="text-xs text-slate-light font-mono mt-0.5">{docDetail.doc_number || "Document number not recorded"}</p>
                </div>

                <div className="space-y-2 text-xs border-t border-b border-ink-mid py-4">
                  <div className="flex justify-between">
                    <span className="text-slate">Category:</span>
                    <span className="text-paper capitalize">{docDetail.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">Classification:</span>
                    <span className={`px-1.5 rounded-sm text-[9px] uppercase font-mono border ${classificationClass(docDetail.classification)}`}>
                      {docDetail.classification || 'internal'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">Status:</span>
                    <span className={`px-1.5 rounded-sm text-[9px] uppercase font-mono border ${statusClass(docDetail.status)}`}>
                      {docDetail.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">File Size:</span>
                    <span className="text-paper font-mono">{sizeValue(documentFileSize(docDetail))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate">Created At:</span>
                    <span className="text-paper">{dateValue(docDetail.created_at)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2 border-b border-ink-mid pb-4">
                  <button className="flex items-center justify-center space-x-2 bg-ink border border-ink-mid hover:bg-ink-mid/30 text-paper px-3 py-2 rounded text-xs transition-colors">
                    <Download className="h-3.5 w-3.5 text-signal" />
                    <span>Download</span>
                  </button>
                  <button className="flex items-center justify-center space-x-2 bg-ink border border-ink-mid hover:bg-ink-mid/30 text-paper px-3 py-2 rounded text-xs transition-colors">
                    <Share2 className="h-3.5 w-3.5 text-slate-light" />
                    <span>Share Link</span>
                  </button>
                </div>

                {/* Status Transitions */}
                <div className="space-y-2">
                  <h4 className="text-[10px] uppercase font-mono tracking-widest text-slate">Approval Status Decisions</h4>
                  <div className="flex space-x-2">
                    {docDetail.status !== "approved" && (
                      <button
                        onClick={() => void handleUpdateStatus(docDetail.id, "approved")}
                        className="flex-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1.5 rounded text-xs font-mono"
                      >
                        Approve Release
                      </button>
                    )}
                    {docDetail.status === "draft" && (
                      <button
                        onClick={() => void handleUpdateStatus(docDetail.id, "in_review")}
                        className="flex-1 bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 px-3 py-1.5 rounded text-xs font-mono"
                      >
                        Submit Review
                      </button>
                    )}
                  </div>
                </div>

                {/* Linked Records */}
                <div className="space-y-2">
                  <h4 className="text-[10px] uppercase font-mono tracking-widest text-slate">Linked Business Entities</h4>
                  {docLinks.length === 0 ? (
                    <p className="text-[11px] text-slate italic">This document is not linked to any operational project records.</p>
                  ) : (
                    <div className="space-y-1.5 font-mono text-[11px]">
                      {docLinks.map((l) => (
                        <div key={l.id} className="bg-ink px-2.5 py-1.5 rounded text-slate-light flex justify-between">
                          <span>{l.entity_type}:</span>
                          <span className="text-paper">{l.entity_id.slice(0, 8)}...</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate mt-4 text-center">Select a document in the repository to view metadata, distribution scopes, and approval states.</p>
            )}
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Upload Controlled Document</span>
              <button onClick={() => setShowUploadModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUploadDocument} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Document Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Concrete mix design specification"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Category</label>
                  <select
                    value={uploadForm.category}
                    onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="drawings">Drawing</option>
                    <option value="specifications">Specification</option>
                    <option value="contracts">Contract / Agreement</option>
                    <option value="compliance">Compliance / Permit</option>
                    <option value="reports">Report</option>
                    <option value="other">Other Supporting</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Classification</label>
                  <select
                    value={uploadForm.classification}
                    onChange={(e) => setUploadForm({ ...uploadForm, classification: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="public">Public</option>
                    <option value="internal">Internal Only</option>
                    <option value="confidential">Confidential</option>
                    <option value="restricted">Restricted</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Project Linkage</label>
                <select
                  value={uploadForm.project_id}
                  onChange={(e) => setUploadForm({ ...uploadForm, project_id: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="">No Project Linkage</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Description</label>
                <textarea
                  placeholder="Supporting scope details..."
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50 h-20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">File name</label>
                  <input
                    type="text"
                    placeholder="e.g. mix-design-rev-a.pdf"
                    value={uploadForm.file_name}
                    onChange={(e) => setUploadForm({ ...uploadForm, file_name: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">File size bytes</label>
                  <input
                    type="number"
                    min="0"
                    value={uploadForm.size_bytes}
                    onChange={(e) => setUploadForm({ ...uploadForm, size_bytes: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Upload & Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
