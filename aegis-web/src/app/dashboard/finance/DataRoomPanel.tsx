"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Folder, FolderOpen, FileText, Upload, Download, Search, CheckCircle2,
  AlertCircle, ShieldCheck, Plus, RefreshCw, X, ChevronRight, ChevronDown,
  Building2, ExternalLink, Filter, Check, Clock, FileCheck, Layers, PieChart,
  HardDrive, Lock, Sparkles, FolderPlus, Eye, ArrowUpDown, Cloud
} from "lucide-react";
import {
  getDataRoomTree,
  getDataRoomDocuments,
  classifyDataRoomUpload,
  issueDataRoomUploadPath,
  uploadDataRoomDocument,
  createDataRoomFolder,
  getDataRoomDocumentSignedUrl,
  updateDataRoomDocumentStatus,
  deleteDataRoomDocument,
  getBankabilityMatrix,
  verifyBankabilityItem,
  getDataRoomExportUrl,
  getInternalProjects,
  getDataRoomSharePointStatus,
  syncDataRoomFromSharePoint,
  uploadDataRoomDocumentToSharePoint,
} from "@/lib/api";
import { supabase } from "@/lib/supabase";

type RecordData = Record<string, any>;

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function sizeValue(bytes: unknown) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function statusBadge(status: string) {
  switch (status) {
    case "verified":
      return <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-950/20 text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Verified</span>;
    case "in_progress":
      return <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-blue-500/30 bg-blue-950/20 text-blue-400"><Clock className="w-3 h-3" /> In Review</span>;
    case "flagged":
    case "rejected":
      return <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-red-500/30 bg-red-950/20 text-red-400"><AlertCircle className="w-3 h-3" /> Flagged</span>;
    default:
      return <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-slate-700 bg-ink text-slate-400">Unverified</span>;
  }
}

export function DataRoomPanel() {
  const [activeView, setActiveView] = useState<"explorer" | "bankability">("explorer");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  // Folder & Tree states
  const [folders, setFolders] = useState<RecordData[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("01 CORPORATE");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    "02 BANKING": true,
    "05 PROJECTS": true,
  });

  // Documents states
  const [documents, setDocuments] = useState<RecordData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [docsLoading, setDocsLoading] = useState(false);

  // Bankability Matrix states
  const [bankabilityData, setBankabilityData] = useState<RecordData | null>(null);
  const [readinessScore, setReadinessScore] = useState<number>(0);
  const [selectedAuditCode, setSelectedAuditCode] = useState<string | null>(null);

  // Projects list
  const [projects, setProjects] = useState<RecordData[]>([]);

  // SharePoint sync state
  const [sharepointStatus, setSharepointStatus] = useState<RecordData>({ connected: false, sync_enabled: false });
  const [syncingSharePoint, setSyncingSharePoint] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [verifyModalItem, setVerifyModalItem] = useState<RecordData | null>(null);
  const [verifyNotes, setVerifyNotes] = useState("");
  const [verifyStatus, setVerifyStatus] = useState("verified");

  // Upload Form
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProject, setUploadProject] = useState("");
  const [uploadDate, setUploadDate] = useState(new Date().toISOString().split("T")[0]);
  const [uploadAmount, setUploadAmount] = useState("");
  const [uploading, setUploading] = useState(false);
  const [classifiedTarget, setClassifiedTarget] = useState<RecordData | null>(null);
  const [customFolderOverride, setCustomFolderOverride] = useState("");
  const [isCustomFolder, setIsCustomFolder] = useState(false);

  // New Folder Form
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState("");

  const loadTreeAndData = useCallback(async () => {
    setLoading(true);
    try {
      const [treeRes, bankRes, projRes, spRes] = await Promise.allSettled([
        getDataRoomTree(),
        getBankabilityMatrix(),
        getInternalProjects(),
        getDataRoomSharePointStatus(),
      ]);

      if (treeRes.status === "fulfilled" && treeRes.value.data) {
        setFolders(treeRes.value.data.folders || []);
        if (treeRes.value.data.readiness) {
          setReadinessScore(treeRes.value.data.readiness.score_pct);
        }
      }
      if (bankRes.status === "fulfilled" && bankRes.value.data) {
        setBankabilityData(bankRes.value.data);
      }
      if (projRes.status === "fulfilled" && projRes.value.data) {
        setProjects(projRes.value.data || []);
      }
      if (spRes.status === "fulfilled" && spRes.value.data) {
        setSharepointStatus(spRes.value.data);
      }
    } catch (err: any) {
      setNotice(err?.message || "Failed to load data room.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTreeAndData();
  }, [loadTreeAndData]);

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await getDataRoomDocuments({
        folder_path: selectedFolder,
        search: searchQuery || undefined,
        verification_status: statusFilter !== "all" ? statusFilter : undefined,
        audit_code: selectedAuditCode || undefined,
      });
      setDocuments(res.data || []);
    } catch (err: any) {
      setNotice(err?.message || "Failed to load folder documents.");
    } finally {
      setDocsLoading(false);
    }
  }, [selectedFolder, searchQuery, statusFilter, selectedAuditCode]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  // Handle auto-classification preview when upload title or project changes
  useEffect(() => {
    if (!uploadTitle) {
      setClassifiedTarget(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await classifyDataRoomUpload({
          title: uploadTitle,
          file_name: uploadFile?.name,
          project_id: uploadProject || undefined,
          document_date: uploadDate,
        });
        if (res.data) {
          setClassifiedTarget(res.data);
        }
      } catch {
        // quiet fallback
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [uploadTitle, uploadFile, uploadProject, uploadDate]);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const handleSelectFolder = (path: string) => {
    setSelectedFolder(path);
    setSelectedAuditCode(null);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle || !uploadFile) {
      setNotice("Please provide a title and select a file.");
      return;
    }

    setUploading(true);
    try {
      // Determine target folder and metadata
      const targetFolder = isCustomFolder && customFolderOverride
        ? customFolderOverride
        : classifiedTarget?.suggested_folder_path || selectedFolder;

      const projId = uploadProject || classifiedTarget?.project_id || undefined;
      const fiscalYr = classifiedTarget?.fiscal_year || new Date(uploadDate).getFullYear();

      if (sharepointStatus.connected && sharepointStatus.sync_enabled) {
        // Push straight to the org's real SharePoint site instead of
        // Supabase Storage - see uploadDataRoomDocumentToSharePoint.
        await uploadDataRoomDocumentToSharePoint({
          file: uploadFile,
          title: uploadTitle,
          folder_path: targetFolder,
          project_id: projId,
          fiscal_year: fiscalYr,
          document_date: uploadDate,
          amount: uploadAmount ? parseFloat(uploadAmount) : undefined,
        });
      } else {
        // 1. Ask the API for a storage path bound to this organization, then
        // upload to Supabase Storage at exactly that path. The register call
        // below rejects any path outside this prefix.
        const pathRes = await issueDataRoomUploadPath({ file_name: uploadFile.name });
        const storagePath = pathRes.data?.storage_path;
        if (!storagePath) throw new Error("Failed to allocate a secure upload location.");

        const { error: uploadErr } = await supabase.storage
          .from("documents")
          .upload(storagePath, uploadFile, { cacheControl: "3600", upsert: false });

        if (uploadErr) throw uploadErr;

        // 2. Register the document against its classified/selected folder
        const sectionCode = classifiedTarget?.section_code || "01_CORPORATE";
        const auditCode = classifiedTarget?.audit_code || undefined;
        const auditSubitem = classifiedTarget?.audit_subitem || undefined;

        await uploadDataRoomDocument({
          title: uploadTitle,
          folder_path: targetFolder,
          section_code: sectionCode,
          audit_code: auditCode,
          audit_subitem: auditSubitem,
          project_id: projId,
          fiscal_year: fiscalYr,
          document_date: uploadDate,
          amount: uploadAmount ? parseFloat(uploadAmount) : undefined,
          currency: "USD",
          file_name: uploadFile.name,
          file_size_bytes: uploadFile.size,
          mime_type: uploadFile.type || "application/octet-stream",
          storage_path: storagePath,
        });
      }

      setNotice(`Document stored and indexed in: ${targetFolder}`);
      setShowUploadModal(false);
      setUploadTitle("");
      setUploadFile(null);
      setUploadAmount("");
      setClassifiedTarget(null);
      setIsCustomFolder(false);
      setSelectedFolder(targetFolder);

      await Promise.all([loadTreeAndData(), loadDocuments()]);
    } catch (err: any) {
      setNotice(err?.message || "Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName) return;
    try {
      await createDataRoomFolder({
        folder_name: newFolderName,
        parent_path: newFolderParent || selectedFolder,
      });
      setNotice("Folder created successfully.");
      setShowNewFolderModal(false);
      setNewFolderName("");
      await loadTreeAndData();
    } catch (err: any) {
      setNotice(err?.message || "Failed to create folder.");
    }
  };

  const handleSyncFromSharePoint = async () => {
    setSyncingSharePoint(true);
    try {
      const res = await syncDataRoomFromSharePoint();
      const summary = res.data;
      setNotice(
        summary
          ? `Sync complete: ${summary.folders_created} folder(s), ${summary.documents_imported} document(s) imported from SharePoint.`
          : "Sync from SharePoint complete."
      );
      await Promise.all([loadTreeAndData(), loadDocuments()]);
    } catch (err: any) {
      setNotice(err?.message || "Failed to sync from SharePoint.");
    } finally {
      setSyncingSharePoint(false);
    }
  };

  const handleOpenDoc = async (docId: string) => {
    try {
      const res = await getDataRoomDocumentSignedUrl(docId);
      if (res.data?.url) {
        window.open(res.data.url, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      setNotice(err?.message || "Could not open document.");
    }
  };

  const handleVerifyDocument = async (docId: string, status: string, notes?: string) => {
    try {
      await updateDataRoomDocumentStatus(docId, {
        verification_status: status,
        audit_notes: notes,
      });
      setNotice(`Document marked as ${status}.`);
      await Promise.all([loadDocuments(), loadTreeAndData()]);
    } catch (err: any) {
      setNotice(err?.message || "Failed to update verification status.");
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm("Are you sure you want to remove this document from the Data Room?")) return;
    try {
      await deleteDataRoomDocument(docId);
      setNotice("Document removed.");
      await Promise.all([loadDocuments(), loadTreeAndData()]);
    } catch (err: any) {
      setNotice(err?.message || "Failed to delete document.");
    }
  };

  const handleVerifyChecklistItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyModalItem) return;
    try {
      await verifyBankabilityItem(verifyModalItem.id, {
        status: verifyStatus,
        notes: verifyNotes,
      });
      setNotice(`Checklist item updated to ${verifyStatus}.`);
      setVerifyModalItem(null);
      setVerifyNotes("");
      await loadTreeAndData();
    } catch (err: any) {
      setNotice(err?.message || "Failed to update audit item.");
    }
  };

  // Build tree hierarchy
  const treeNodes = useMemo(() => {
    const rootFolders = folders.filter(f => !f.parent_path);
    const childMap: Record<string, RecordData[]> = {};
    folders.forEach(f => {
      if (f.parent_path) {
        if (!childMap[f.parent_path]) childMap[f.parent_path] = [];
        childMap[f.parent_path].push(f);
      }
    });
    return { rootFolders, childMap };
  }, [folders]);

  const renderFolderItem = (folder: RecordData, depth = 0) => {
    const hasChildren = Boolean(treeNodes.childMap[folder.folder_path]?.length);
    const isExpanded = Boolean(expandedFolders[folder.folder_path]);
    const isSelected = selectedFolder === folder.folder_path;

    return (
      <div key={folder.folder_path} className="select-none">
        <div
          onClick={() => handleSelectFolder(folder.folder_path)}
          className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors ${
            isSelected
              ? "bg-signal/20 text-signal font-semibold border-l-2 border-signal"
              : "text-slate-light hover:bg-ink-mid/30 hover:text-paper"
          }`}
          style={{ paddingLeft: `${Math.max(10, depth * 16 + 10)}px` }}
        >
          <div className="flex items-center gap-2 truncate">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolder(folder.folder_path);
                }}
                className="p-0.5 text-slate hover:text-paper"
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-3.5 h-3.5" />
            )}

            {isSelected ? (
              <FolderOpen className="w-4 h-4 text-signal shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-slate shrink-0" />
            )}
            <span className="truncate">{folder.folder_name}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {folder.document_count > 0 && (
              <span className="bg-ink px-1.5 py-0.5 rounded text-[10px] font-mono text-slate border border-ink-mid">
                {folder.document_count}
              </span>
            )}
            {folder.verified_count > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title={`${folder.verified_count} verified`} />
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="space-y-0.5">
            {treeNodes.childMap[folder.folder_path].map((child) => renderFolderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      {notice && (
        <div className="bg-ink-light border border-signal/30 px-4 py-3 rounded flex items-center justify-between text-paper text-sm shadow">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header & Controls */}
      <div className="bg-ink-light border border-ink-mid p-5 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-signal text-ink p-1.5 rounded font-mono font-bold text-xs">SNC</span>
              <h2 className="text-xl font-semibold text-paper tracking-tight font-display">
                Financial Data Room & Bankability Engine
              </h2>
            </div>
            <p className="text-xs text-slate mt-1 font-sans">
              Authoritative 18-folder corporate finance archive, project-level audit dossiers, and BS-100/BS-800 bankability criteria.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center border border-ink-mid rounded overflow-hidden font-mono text-xs uppercase">
              <button
                onClick={() => setActiveView("explorer")}
                className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                  activeView === "explorer" ? "bg-signal text-ink font-semibold" : "text-slate hover:text-paper"
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Repository Explorer</span>
              </button>
              <button
                onClick={() => setActiveView("bankability")}
                className={`px-3 py-1.5 flex items-center gap-1.5 border-l border-ink-mid transition-colors ${
                  activeView === "bankability" ? "bg-signal text-ink font-semibold" : "text-slate hover:text-paper"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Bankability Matrix (BS-100..800)</span>
              </button>
            </div>

            {/* Smart Upload Button */}
            <button
              onClick={() => {
                setUploadProject(projects.find(p => selectedFolder.includes(p.name))?.id || "");
                setShowUploadModal(true);
              }}
              className="flex items-center gap-2 bg-signal text-ink font-medium px-3.5 py-1.5 rounded text-xs hover:bg-signal/90 transition-colors shadow-sm"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Smart Upload</span>
            </button>

            {/* New Folder Button */}
            <button
              onClick={() => {
                setNewFolderParent(selectedFolder);
                setShowNewFolderModal(true);
              }}
              className="flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 rounded text-xs text-paper hover:bg-ink-mid/40 transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-slate" />
              <span>New Folder</span>
            </button>

            {/* Sync from SharePoint Button - only when the org's Data Room
                SharePoint sync is actually connected and enabled */}
            {sharepointStatus.connected && sharepointStatus.sync_enabled && (
              <button
                onClick={handleSyncFromSharePoint}
                disabled={syncingSharePoint}
                className="flex items-center gap-1.5 border border-sky-500/40 bg-sky-950/20 px-3 py-1.5 rounded text-xs text-sky-400 hover:bg-sky-950/40 transition-colors disabled:opacity-50"
                title="Import files added directly in the connected SharePoint site"
              >
                <Cloud className={`w-3.5 h-3.5 ${syncingSharePoint ? "animate-pulse" : ""}`} />
                <span>{syncingSharePoint ? "Syncing..." : "Sync from SharePoint"}</span>
              </button>
            )}

            {/* Export Button */}
            <a
              href={getDataRoomExportUrl(selectedFolder)}
              download
              className="flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 rounded text-xs text-paper hover:bg-ink-mid/40 transition-colors"
              title="Download structured ZIP maintaining folder paths"
            >
              <Download className="w-3.5 h-3.5 text-signal" />
              <span>Export Folder ZIP</span>
            </a>

            <a
              href={getDataRoomExportUrl()}
              download
              className="flex items-center gap-1.5 border border-signal/40 bg-signal/10 px-3 py-1.5 rounded text-xs text-signal hover:bg-signal/20 transition-colors"
              title="Download entire 18-folder data room with audit manifest"
            >
              <HardDrive className="w-3.5 h-3.5 text-signal" />
              <span>Full Data Room ZIP</span>
            </a>
          </div>
        </div>

        {/* Bankability Readiness Strip */}
        <div className="mt-4 pt-4 border-t border-ink-mid grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-signal/10 border border-signal/30 flex items-center justify-center text-signal font-bold text-sm">
              {readinessScore}%
            </div>
            <div>
              <p className="text-[10px] uppercase font-mono text-slate tracking-wider">Institutional Readiness</p>
              <p className="text-xs font-semibold text-paper">Bank & Audit Score</p>
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="flex justify-between text-[11px] font-mono text-slate mb-1">
              <span>BS-100 to BS-800 Audit Readiness Progress</span>
              <span className="text-paper font-semibold">{readinessScore}% Complete</span>
            </div>
            <div className="w-full bg-ink h-2 rounded-full overflow-hidden border border-ink-mid">
              <div
                className="bg-signal h-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, readinessScore))}%` }}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setActiveView("bankability")}
              className="text-xs font-mono text-signal hover:underline flex items-center gap-1"
            >
              <span>View Audit Checklist</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {activeView === "explorer" ? (
        /* EXPLORER VIEW (Tree + Documents Table) */
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Tree Explorer */}
          <div className="bg-ink-light border border-ink-mid rounded-lg shadow p-4 space-y-3 h-[720px] flex flex-col">
            <div className="flex items-center justify-between border-b border-ink-mid pb-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate">
                <Layers className="w-4 h-4 text-signal" />
                <span>Repository Structure</span>
              </div>
              <button
                onClick={loadTreeAndData}
                className="text-slate hover:text-paper p-1 rounded hover:bg-ink"
                title="Refresh tree"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
              {treeNodes.rootFolders.map((root) => renderFolderItem(root))}
            </div>
          </div>

          {/* Right Documents Workspace */}
          <div className="lg:col-span-3 bg-ink-light border border-ink-mid rounded-lg shadow flex flex-col h-[720px]">
            {/* Folder Breadcrumb & Filter Header */}
            <div className="p-4 border-b border-ink-mid flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-ink/30">
              <div className="flex items-center gap-1.5 text-xs text-paper truncate font-mono">
                <FolderOpen className="w-4 h-4 text-signal shrink-0" />
                <span className="text-slate">DATA ROOM /</span>
                <span className="font-semibold text-paper truncate">{selectedFolder}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-ink border border-ink-mid rounded pl-8 pr-3 py-1.5 text-xs text-paper focus:outline-none focus:border-signal/50 w-44"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-ink border border-ink-mid rounded px-2.5 py-1.5 text-xs text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="all">All Status</option>
                  <option value="verified">Verified</option>
                  <option value="unverified">Unverified</option>
                  <option value="flagged">Flagged</option>
                </select>
              </div>
            </div>

            {/* Documents Table */}
            <div className="flex-1 overflow-y-auto">
              {docsLoading ? (
                <div className="flex h-64 items-center justify-center">
                  <RefreshCw className="w-6 h-6 animate-spin text-signal" />
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-ink border border-ink-mid flex items-center justify-center text-slate">
                    <Folder className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-paper">No documents in this folder</p>
                    <p className="text-xs text-slate mt-0.5 max-w-sm">
                      Upload invoices, receipts, contracts, or bank statements. Aegis will automatically preserve the audit hierarchy.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center gap-2 bg-signal text-ink font-medium px-4 py-1.5 rounded text-xs hover:bg-signal/90"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload to this folder</span>
                  </button>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono uppercase tracking-wider bg-ink/40">
                      <th className="p-3 font-medium">Document</th>
                      <th className="p-3 font-medium">Audit Category</th>
                      <th className="p-3 font-medium">Amount</th>
                      <th className="p-3 font-medium">Date</th>
                      <th className="p-3 font-medium">Size</th>
                      <th className="p-3 font-medium">Verification</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {documents.map((doc) => (
                      <tr key={doc.id} className="hover:bg-ink-mid/20 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2.5">
                            <FileText className="w-4 h-4 text-signal/80 shrink-0" />
                            <div className="truncate max-w-xs">
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold text-paper truncate hover:text-signal cursor-pointer" onClick={() => handleOpenDoc(doc.id)}>
                                  {doc.title}
                                </p>
                                {doc.provider === "sharepoint" && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-950/20 text-sky-400 shrink-0"
                                    title="Stored in SharePoint"
                                  >
                                    <Cloud className="w-2.5 h-2.5" /> SharePoint
                                  </span>
                                )}
                                {doc.provider === "sharepoint" && doc.sharepoint_web_url && (
                                  <a
                                    href={doc.sharepoint_web_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-slate hover:text-sky-400 shrink-0"
                                    title="Open in SharePoint"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <p className="text-[10px] text-slate font-mono truncate">{doc.file_name}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          {doc.audit_code ? (
                            <div>
                              <span className="font-mono text-sky-400 font-semibold">{doc.audit_code}</span>
                              <span className="text-[11px] text-slate block truncate">{doc.audit_subitem}</span>
                            </div>
                          ) : (
                            <span className="text-slate font-mono">—</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-paper">
                          {doc.amount ? money(doc.amount) : "—"}
                        </td>
                        <td className="p-3 text-slate font-mono whitespace-nowrap">
                          {doc.document_date ? new Date(doc.document_date).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3 text-slate font-mono whitespace-nowrap">
                          {sizeValue(doc.file_size_bytes)}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {statusBadge(doc.verification_status)}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenDoc(doc.id)}
                              className="p-1 text-slate hover:text-signal"
                              title="Preview / Download Document"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {doc.verification_status !== "verified" ? (
                              <button
                                onClick={() => handleVerifyDocument(doc.id, "verified")}
                                className="p-1 text-slate hover:text-emerald-400"
                                title="Sign-off / Verify Document"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleVerifyDocument(doc.id, "unverified")}
                                className="p-1 text-emerald-400 hover:text-slate"
                                title="Unverify"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}

                            <button
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="p-1 text-slate hover:text-red-400"
                              title="Delete Document"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* BANKABILITY & AUDIT READINESS MATRIX (BS-100 TO BS-800) */
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {bankabilityData?.categories?.map((cat: RecordData) => (
              <div
                key={cat.code}
                className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-3"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-mono font-bold text-signal">{cat.code}</span>
                    <h3 className="text-sm font-semibold text-paper">{cat.category}</h3>
                  </div>
                  <span className="text-xs font-mono text-paper bg-ink px-2 py-0.5 rounded border border-ink-mid">
                    {cat.verified}/{cat.total} Ready
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-ink h-1.5 rounded-full overflow-hidden border border-ink-mid">
                  <div
                    className="bg-emerald-400 h-full transition-all duration-300"
                    style={{ width: `${(cat.verified / (cat.total || 1)) * 100}%` }}
                  />
                </div>

                {/* Criteria items */}
                <div className="space-y-2 pt-1">
                  {cat.items?.map((item: RecordData) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded bg-ink/40 border border-ink-mid text-xs hover:border-signal/40 transition-colors"
                    >
                      <div className="truncate mr-2">
                        <p className="font-medium text-paper truncate">{item.item_name}</p>
                        <p className="text-[10px] text-slate truncate">
                          {item.proof_count > 0 ? `${item.proof_count} documents attached` : "Missing audit proof"}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {statusBadge(item.status)}
                        <button
                          onClick={() => {
                            setVerifyModalItem(item);
                            setVerifyStatus(item.status === "verified" ? "pending" : "verified");
                            setVerifyNotes(item.notes || "");
                          }}
                          className="p-1 text-slate hover:text-paper"
                          title="Audit sign-off"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SMART UPLOAD MODAL */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4">
          <div className="bg-ink-light border border-ink-mid w-full max-w-lg p-6 rounded-lg shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-signal" />
                <span className="text-base font-semibold text-paper">Smart Document Upload</span>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="text-slate hover:text-paper">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">
                  Upload Title / Description *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Receipt for bulk cement purchase - Hillcrest Hospital 2025"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
                <p className="text-[11px] text-slate mt-1">
                  Aegis detects project, year, and audit classification automatically from the title.
                </p>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Select File *</label>
                <input
                  type="file"
                  required
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-xs text-paper file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-signal file:text-ink hover:file:bg-signal/90"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Associated Project</label>
                  <select
                    value={uploadProject}
                    onChange={(e) => setUploadProject(e.target.value)}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="">None / Corporate Level</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Document Date</label>
                  <input
                    type="date"
                    value={uploadDate}
                    onChange={(e) => setUploadDate(e.target.value)}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Invoice / Receipt Amount (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Optional financial ledger amount"
                  value={uploadAmount}
                  onChange={(e) => setUploadAmount(e.target.value)}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>

              {/* Automatic Destination Preview Box */}
              <div className="bg-ink border border-signal/30 p-3.5 rounded space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-signal uppercase">Auto-Routing Destination</span>
                  <button
                    type="button"
                    onClick={() => setIsCustomFolder(!isCustomFolder)}
                    className="text-[11px] text-slate hover:text-paper underline"
                  >
                    {isCustomFolder ? "Use Auto-Route" : "Override Folder"}
                  </button>
                </div>

                {!isCustomFolder ? (
                  <div className="space-y-1 text-xs">
                    <p className="text-paper">
                      <span className="text-slate">Target Path: </span>
                      <code className="bg-ink-mid/40 px-1.5 py-0.5 rounded text-signal font-mono">
                        {classifiedTarget?.suggested_folder_path || selectedFolder}
                      </code>
                    </p>
                    {classifiedTarget?.audit_code && (
                      <p className="text-paper">
                        <span className="text-slate">Audit Tag: </span>
                        <span className="font-mono text-sky-400 font-semibold">{classifiedTarget.audit_code}</span> ({classifiedTarget.audit_subitem})
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] text-slate mb-1">Custom Folder Path</label>
                    <input
                      type="text"
                      placeholder="e.g. 05 PROJECTS/Hillcrest Hospital/Custom Folder"
                      value={customFolderOverride}
                      onChange={(e) => setCustomFolderOverride(e.target.value)}
                      className="w-full bg-ink-light border border-ink-mid rounded px-3 py-1.5 text-xs text-paper"
                    />
                  </div>
                )}
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
                  disabled={uploading}
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/90 disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Upload & Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE FOLDER MODAL */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-lg shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Create New Subfolder</span>
              <button onClick={() => setShowNewFolderModal(false)} className="text-slate hover:text-paper">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Parent Folder</label>
                <input
                  type="text"
                  value={newFolderParent}
                  onChange={(e) => setNewFolderParent(e.target.value)}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-xs text-slate-light font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Folder Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2026 Audit Pack"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/90"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUDIT CHECKLIST VERIFICATION MODAL */}
      {verifyModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-lg shadow-xl space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Audit Checklist Sign-Off</span>
              <button onClick={() => setVerifyModalItem(null)} className="text-slate hover:text-paper">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleVerifyChecklistItem} className="space-y-4">
              <div>
                <p className="text-xs font-mono text-signal">{verifyModalItem.audit_code}</p>
                <h4 className="text-sm font-semibold text-paper mt-0.5">{verifyModalItem.item_name}</h4>
                <p className="text-xs text-slate mt-1">{verifyModalItem.description}</p>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Sign-Off Status</label>
                <select
                  value={verifyStatus}
                  onChange={(e) => setVerifyStatus(e.target.value)}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper"
                >
                  <option value="verified">Verified (Compliant)</option>
                  <option value="in_progress">In Progress (Reviewing)</option>
                  <option value="pending">Pending Documents</option>
                  <option value="waived">Waived by Credit Committee</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Auditor / Reviewer Notes</label>
                <textarea
                  rows={3}
                  placeholder="Reference external validation, bank confirmations, or exceptions..."
                  value={verifyNotes}
                  onChange={(e) => setVerifyNotes(e.target.value)}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-xs text-paper"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setVerifyModalItem(null)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/90"
                >
                  Save Verification
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
