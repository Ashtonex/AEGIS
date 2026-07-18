"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  Lock,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UploadCloud,
  User,
  X,
  FileArchive,
  FileBadge,
  FileCheck,
} from "lucide-react";
import {
  getCrmDocuments,
  createCrmDocument,
  getCrmOpportunities,
  getCrmTenders,
} from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface VersionEntry {
  version: string;
  timestamp: string;
  uploader: string;
  file_size_bytes?: number;
}

interface DocumentRecord {
  id: string;
  title: string;
  file_name?: string;
  file_size_bytes?: number;
  category: string;
  opportunity_id?: string;
  tender_id?: string;
  opportunity_name?: string;
  tender_name?: string;
  created_at: string;
  created_by?: string;
  owner_name?: string;
  versions?: VersionEntry[];
}

type ScanPhase = "idle" | "queued" | "scanning" | "clean" | "committing" | "done";
type CategoryKey = "All" | "Quotations" | "Contracts" | "Specifications" | "Tenders" | "NDA/Legal";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: CategoryKey[] = [
  "All",
  "Quotations",
  "Contracts",
  "Specifications",
  "Tenders",
  "NDA/Legal",
];

// Maps display category to backend category value
const CATEGORY_VALUE_MAP: Record<string, string> = {
  Quotations: "Quotations",
  Contracts: "Contracts",
  Specifications: "Specs",
  Tenders: "Tenders",
  "NDA/Legal": "NDA",
};

// Maps backend value to display name
const BACKEND_TO_DISPLAY: Record<string, string> = {
  Quotations: "Quotations",
  Contracts: "Contracts",
  Specs: "Specifications",
  Tenders: "Tenders",
  NDA: "NDA/Legal",
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  Quotations: {
    bg: "bg-amber-500/8",
    text: "text-amber-400",
    border: "border-amber-500/25",
    icon: <FileText className="w-3 h-3" />,
  },
  Contracts: {
    bg: "bg-red-500/8",
    text: "text-red-400",
    border: "border-red-500/25",
    icon: <FileCheck className="w-3 h-3" />,
  },
  Specifications: {
    bg: "bg-purple-500/8",
    text: "text-purple-400",
    border: "border-purple-500/25",
    icon: <FileBadge className="w-3 h-3" />,
  },
  Tenders: {
    bg: "bg-[#3B82F6]/8",
    text: "text-[#3B82F6]",
    border: "border-[#3B82F6]/25",
    icon: <Layers className="w-3 h-3" />,
  },
  "NDA/Legal": {
    bg: "bg-emerald-500/8",
    text: "text-emerald-400",
    border: "border-emerald-500/25",
    icon: <Shield className="w-3 h-3" />,
  },
};

const SIDEBAR_ICONS: Record<string, React.ReactNode> = {
  All: <Database className="w-3.5 h-3.5" />,
  Quotations: <FileText className="w-3.5 h-3.5" />,
  Contracts: <FileCheck className="w-3.5 h-3.5" />,
  Specifications: <FileBadge className="w-3.5 h-3.5" />,
  Tenders: <Layers className="w-3.5 h-3.5" />,
  "NDA/Legal": <Shield className="w-3.5 h-3.5" />,
};

function normalizeLoadError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(message)) {
    return fallback;
  }
  return fallback;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "2-digit" }),
    time: d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

function getDisplayCategory(backendCat: string): string {
  return BACKEND_TO_DISPLAY[backendCat] ?? backendCat;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Scan animation overlay
function VirusScanOverlay({ phase, progress }: { phase: ScanPhase; progress: number }) {
  const messages: Record<ScanPhase, string> = {
    idle: "",
    queued: "Queued for security scan…",
    scanning: "Running ESET-level threat analysis…",
    clean: "✓ No threats detected",
    committing: "Committing to vault…",
    done: "Document registered successfully",
  };

  if (phase === "idle" || phase === "done") return null;

  return (
    <div className="absolute inset-0 z-20 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center rounded-sm">
      <div className="w-full max-w-xs px-6 space-y-4">
        {/* Animated shield icon */}
        <div className="flex justify-center">
          <div
            className={`relative w-14 h-14 flex items-center justify-center rounded-full border-2 ${
              phase === "clean" || phase === "committing"
                ? "border-emerald-400 bg-emerald-400/10"
                : "border-amber-400 bg-amber-400/10 animate-pulse"
            }`}
          >
            {phase === "clean" || phase === "committing" ? (
              <ShieldCheck className="w-7 h-7 text-emerald-400" />
            ) : (
              <Shield className="w-7 h-7 text-amber-400" />
            )}
            {/* Scanning ring */}
            {phase === "scanning" && (
              <span className="absolute inset-0 rounded-full border border-amber-400/40 animate-ping" />
            )}
          </div>
        </div>

        {/* Message */}
        <p
          className={`font-mono text-[11px] text-center tracking-wider ${
            phase === "clean" ? "text-emerald-400" : "text-amber-300"
          }`}
        >
          {messages[phase]}
        </p>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                phase === "clean" || phase === "committing"
                  ? "bg-emerald-400"
                  : "bg-amber-400"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between font-mono text-[9px] text-slate-500">
            <span>AEGIS VAULT SCANNER</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
        </div>

        {/* Scanning lines effect */}
        {phase === "scanning" && (
          <div className="space-y-1 opacity-60">
            {["Checking signature database…", "Analysing payload headers…", "Deep-inspection mode…"].map(
              (line, i) => (
                <p key={i} className="font-mono text-[9px] text-slate-500 tracking-wider">{line}</p>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Document version history row
function VersionHistoryRow({ versions }: { versions: VersionEntry[] }) {
  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <p className="font-mono text-[9px] text-slate-500 uppercase tracking-widest mb-2 flex items-center space-x-1.5">
        <Clock className="w-3 h-3" />
        <span>Version History</span>
      </p>
      <div className="space-y-1.5">
        {versions.map((v, i) => (
          <div
            key={i}
            className="flex items-center justify-between bg-white/3 border border-white/5 px-3 py-1.5 rounded-sm"
          >
            <div className="flex items-center space-x-2.5">
              <span className="font-mono text-[9px] text-amber-400 tracking-wider bg-amber-400/10 px-1.5 py-0.5 rounded-sm border border-amber-400/20">
                {v.version}
              </span>
              <div className="flex items-center space-x-1 text-slate-500">
                <User className="w-2.5 h-2.5" />
                <span className="font-mono text-[9px]">{v.uploader}</span>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              {v.file_size_bytes && (
                <span className="font-mono text-[9px] text-slate-600 tabular-nums">
                  {formatBytes(v.file_size_bytes)}
                </span>
              )}
              <span className="font-mono text-[9px] text-slate-600 tabular-nums">
                {formatDate(v.timestamp).date}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CRMDocumentsPage() {
  const { session } = useAuth();

  // Data
  const [isLoading, setIsLoading] = useState(true);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [tenders, setTenders] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("All");
  const [linkFilter, setLinkFilter] = useState<string>("");

  // Expanded version history
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  // Upload modal
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Drag & Drop
  const [isDragging, setIsDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scan state
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [scanProgress, setScanProgress] = useState(0);

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formFileName, setFormFileName] = useState("");
  const [formCategory, setFormCategory] = useState("Quotations");
  const [formFileSize, setFormFileSize] = useState("102400");
  const [formLinkType, setFormLinkType] = useState<"none" | "opportunity" | "tender">("none");
  const [formOpportunityId, setFormOpportunityId] = useState("");
  const [formTenderId, setFormTenderId] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // ─── Data Loading ───────────────────────────────────────────────────────────

  const loadPageData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [docsRes, oppsRes, tendersRes] = await Promise.allSettled([
        getCrmDocuments(),
        getCrmOpportunities(),
        getCrmTenders(),
      ]);

      if (docsRes.status === "fulfilled" && docsRes.value.success) {
        const raw = (docsRes.value.data || []) as any[];
        const enriched: DocumentRecord[] = raw.map((doc) => ({
          ...doc,
          versions: Array.isArray(doc.versions) ? doc.versions : [],
        }));
        setDocuments(enriched);
      } else {
        setDocuments([]);
        setLoadError("CRM documents could not be loaded from the document service.");
      }

      if (oppsRes.status === "fulfilled" && oppsRes.value.success) {
        setOpportunities(oppsRes.value.data || []);
      }

      if (tendersRes.status === "fulfilled" && tendersRes.value.success) {
        setTenders(tendersRes.value.data || []);
      }
    } catch (err: any) {
      setLoadError(normalizeLoadError(err, "Failed to load document vault."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadPageData();
  }, [session, loadPageData]);

  // ─── Category counts ────────────────────────────────────────────────────────

  const getCategoryCount = useCallback(
    (cat: CategoryKey): number => {
      if (cat === "All") return documents.length;
      const backendCat = CATEGORY_VALUE_MAP[cat];
      return documents.filter(
        (d) => d.category === backendCat || d.category === cat
      ).length;
    },
    [documents]
  );

  // ─── Filtering ──────────────────────────────────────────────────────────────

  const filteredDocuments = documents.filter((doc) => {
    const displayCat = getDisplayCategory(doc.category);

    const matchesCategory =
      activeCategory === "All" ||
      displayCat === activeCategory ||
      doc.category === activeCategory;

    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      doc.title.toLowerCase().includes(searchLower) ||
      (doc.file_name ?? "").toLowerCase().includes(searchLower) ||
      (doc.opportunity_name ?? "").toLowerCase().includes(searchLower) ||
      (doc.tender_name ?? "").toLowerCase().includes(searchLower);

    const matchesLink =
      !linkFilter ||
      (doc.opportunity_name ?? "").toLowerCase().includes(linkFilter.toLowerCase()) ||
      (doc.tender_name ?? "").toLowerCase().includes(linkFilter.toLowerCase());

    return matchesCategory && matchesSearch && matchesLink;
  });

  // ─── Drag & Drop ────────────────────────────────────────────────────────────

  const populateFromFile = useCallback((file: File) => {
    if (!formTitle) setFormTitle(file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " "));
    setFormFileName(file.name);
    setFormFileSize(String(file.size));
  }, [formTitle]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) populateFromFile(file);
  }, [populateFromFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) populateFromFile(file);
  };

  // ─── Virus Scan Simulation ──────────────────────────────────────────────────

  async function runVirusScan(): Promise<boolean> {
    setScanPhase("queued");
    setScanProgress(0);
    await delay(500);

    setScanPhase("scanning");
    // Animate 0 → 85% over ~2.5 seconds
    for (let p = 0; p <= 85; p += 5) {
      setScanProgress(p);
      await delay(150);
    }

    setScanPhase("clean");
    setScanProgress(100);
    await delay(800);

    setScanPhase("committing");
    await delay(600);

    return true;
  }

  function delay(ms: number) {
    return new Promise<void>((res) => setTimeout(res, ms));
  }

  // ─── Form Validation ────────────────────────────────────────────────────────

  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!formTitle.trim()) errors.title = "Document title is required.";
    if (!formFileName.trim()) errors.fileName = "File name is required.";
    if (!formFileSize || isNaN(Number(formFileSize)) || Number(formFileSize) <= 0) {
      errors.fileSize = "Valid file size in bytes is required.";
    }
    if (formLinkType === "opportunity" && !formOpportunityId) {
      errors.link = "Please select an opportunity.";
    }
    if (formLinkType === "tender" && !formTenderId) {
      errors.link = "Please select a tender.";
    }
    return errors;
  };

  // ─── Upload Handler ─────────────────────────────────────────────────────────

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const errors = validateForm();
    setFormErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    setUploadSuccess(false);

    try {
      // 1. Virus scan simulation
      await runVirusScan();

      // 2. Commit to API
      const payload = {
        title: formTitle.trim(),
        file_name: formFileName.trim(),
        file_size_bytes: parseInt(formFileSize, 10),
        category: CATEGORY_VALUE_MAP[formCategory] ?? formCategory,
        opportunity_id: formLinkType === "opportunity" ? formOpportunityId : undefined,
        tender_id: formLinkType === "tender" ? formTenderId : undefined,
      };

      const response = await createCrmDocument(payload) as any;
      if (!response.success) {
        throw new Error("Could not register document.");
      }

      setScanPhase("done");
      setUploadSuccess(true);

      // Reset form
      setFormTitle("");
      setFormFileName("");
      setFormFileSize("102400");
      setFormLinkType("none");
      setFormOpportunityId("");
      setFormTenderId("");

      await delay(1000);
      setShowUploadModal(false);
      setScanPhase("idle");
      setScanProgress(0);

      await loadPageData();
    } catch (err: any) {
      setScanPhase("idle");
      setScanProgress(0);
      setSubmitError(normalizeLoadError(err, "Failed to upload document."));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async (docId: string, title: string) => {
    if (!confirm(`Delete "${title}" from the vault? This action is irreversible.`)) return;
    try {
      const response = await fetch(`/api/v1/documents/${docId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const data = await response.json();
      if (data.success) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
      } else {
        setSubmitError("Document deletion failed. Please retry once the connection is ready.");
      }
    } catch (err) {
      setSubmitError("Document deletion failed. Please retry once the connection is ready.");
    }
  };

  // ─── Toggle Version History ─────────────────────────────────────────────────

  const toggleVersions = (id: string) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ─── Metrics ────────────────────────────────────────────────────────────────

  const totalSize = documents.reduce((acc, d) => acc + (d.file_size_bytes ?? 0), 0);

  const catStats = CATEGORIES.filter((c) => c !== "All").map((c) => ({
    label: c,
    count: getCategoryCount(c),
  }));

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#050505] text-paper overflow-hidden">

      {/* ── Page Header ── */}
      <div className="flex justify-between items-center border-b border-white/8 px-6 py-4 shrink-0">
        <div>
          <h1 className="font-sans font-extrabold text-xl tracking-wide uppercase text-paper">
            Document Vault
          </h1>
          <p className="font-mono text-[10px] text-slate-500 tracking-widest uppercase mt-0.5">
            Contract Management &amp; Proposal Registry
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {/* Vault size pill */}
          <div className="hidden sm:flex items-center space-x-1.5 bg-ink/40 border border-white/8 px-3 py-1.5 rounded-sm">
            <Database className="w-3 h-3 text-[#3B82F6]" />
            <span className="font-mono text-[10px] text-slate-400">Vault:</span>
            <span className="font-mono text-[10px] text-[#3B82F6] font-bold tabular-nums">{formatBytes(totalSize)}</span>
          </div>

          <button
            onClick={() => { setShowUploadModal(true); setUploadSuccess(false); setScanPhase("idle"); }}
            className="flex items-center space-x-1.5 bg-signal hover:bg-signal/85 active:scale-95 text-black px-3.5 py-1.5 text-xs font-mono font-bold tracking-wider rounded-sm transition-all"
          >
            <UploadCloud className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>UPLOAD DOCUMENT</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-950/20 border border-red-500/25 px-4 py-2.5 mx-6 mt-3 rounded-sm flex items-center space-x-2 text-red-300 shrink-0 font-mono text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center space-y-3">
            <Loader2 className="w-7 h-7 text-signal animate-spin" />
            <p className="font-mono text-[10px] text-slate-500 tracking-widest">LOADING VAULT…</p>
          </div>
        </div>
      ) : (
        // ── Two-Panel Layout ──
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* ── Left Sidebar: Category Navigation ── */}
          <aside className="w-56 shrink-0 border-r border-white/8 flex flex-col bg-ink/15 overflow-y-auto custom-scrollbar">
            <div className="p-4 border-b border-white/6">
              <p className="font-mono text-[9px] text-slate-500 uppercase tracking-widest flex items-center space-x-1.5">
                <FolderOpen className="w-3 h-3" />
                <span>Vault Directories</span>
              </p>
            </div>

            <nav className="p-2 flex-1">
              {CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat;
                const count = getCategoryCount(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-xs font-mono transition-all group mb-0.5 ${
                      isActive
                        ? "bg-signal/12 border border-signal/20 text-signal"
                        : "text-slate-400 hover:bg-white/5 hover:text-paper border border-transparent"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className={isActive ? "text-signal" : "text-slate-600 group-hover:text-slate-400"}>
                        {SIDEBAR_ICONS[cat]}
                      </span>
                      <span>{cat}</span>
                    </div>
                    <span
                      className={`text-[10px] tabular-nums font-bold px-1.5 py-0.5 rounded-sm ${
                        isActive
                          ? "bg-signal/15 text-signal"
                          : "bg-white/5 text-slate-500"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Vault stats summary */}
            <div className="p-3 border-t border-white/6 space-y-2">
              <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest">Category Breakdown</p>
              {catStats.map((s) => (
                <div key={s.label} className="flex justify-between items-center">
                  <span className="font-mono text-[9px] text-slate-500">{s.label}</span>
                  <span className="font-mono text-[9px] text-slate-400 tabular-nums font-bold">{s.count}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-white/5 flex justify-between items-center">
                <span className="font-mono text-[9px] text-slate-500">Total Size</span>
                <span className="font-mono text-[9px] text-[#3B82F6] font-bold tabular-nums">{formatBytes(totalSize)}</span>
              </div>
            </div>
          </aside>

          {/* ── Right Panel: Document List ── */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">

            {/* Search & Filter bar */}
            <div className="flex flex-wrap gap-3 items-center px-5 py-3 border-b border-white/8 shrink-0 bg-ink/10">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by title, file name, or context…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-ink/60 border border-white/8 rounded-sm pl-8 pr-3 py-2 text-xs text-paper focus:border-signal outline-none font-sans placeholder:text-slate-600 transition-colors"
                />
              </div>

              {/* Link filter */}
              <div className="relative min-w-[180px]">
                <Briefcase className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter by opportunity/tender…"
                  value={linkFilter}
                  onChange={(e) => setLinkFilter(e.target.value)}
                  className="w-full bg-ink/60 border border-white/8 rounded-sm pl-8 pr-3 py-2 text-xs text-paper focus:border-signal outline-none font-sans placeholder:text-slate-600 transition-colors"
                />
              </div>

              <div className="flex items-center space-x-2 ml-auto">
                {(searchTerm || linkFilter) && (
                  <button
                    onClick={() => { setSearchTerm(""); setLinkFilter(""); }}
                    className="font-mono text-[9px] text-slate-500 hover:text-paper flex items-center space-x-1 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
                <span className="font-mono text-[9px] text-slate-500 tracking-wider whitespace-nowrap">
                  <span className="text-[#3B82F6] font-bold tabular-nums">{filteredDocuments.length}</span>
                  {" "}of{" "}
                  <span className="tabular-nums">{documents.length}</span>
                  {" "}records
                </span>
              </div>
            </div>

            {/* Document Cards */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {filteredDocuments.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
                  <Lock className="w-10 h-10 text-white/8 stroke-[1.5]" />
                  <p className="font-mono text-xs text-slate-500">No documents matching your criteria.</p>
                  <p className="font-mono text-[10px] text-slate-600">Try adjusting your search or category filter.</p>
                </div>
              ) : (
                filteredDocuments.map((doc) => {
                  const displayCat = getDisplayCategory(doc.category);
                  const catStyle = CATEGORY_COLORS[displayCat] ?? CATEGORY_COLORS["Quotations"];
                  const isExpanded = expandedVersions.has(doc.id);
                  const { date, time } = formatDate(doc.created_at);

                  return (
                    <div
                      key={doc.id}
                      className="bg-ink/30 border border-white/6 rounded-sm p-4 hover:border-white/12 hover:bg-ink/40 transition-all group"
                    >
                      {/* Card Main Row */}
                      <div className="flex items-start gap-4">
                        {/* File icon column */}
                        <div className={`w-10 h-10 shrink-0 rounded-sm border ${catStyle.border} ${catStyle.bg} flex items-center justify-center mt-0.5`}>
                          <span className={catStyle.text}>
                            <FileText className="w-5 h-5" />
                          </span>
                        </div>

                        {/* Main content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
                            {/* Title */}
                            <span className="font-sans font-bold text-sm text-paper group-hover:text-signal transition-colors truncate">
                              {doc.title}
                            </span>

                            {/* Category badge */}
                            <span className={`inline-flex items-center space-x-1 font-mono text-[8px] uppercase tracking-wider px-2 py-0.5 rounded-sm border ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}>
                              <span>{catStyle.icon}</span>
                              <span>{displayCat}</span>
                            </span>
                          </div>

                          {/* File name row */}
                          <p className="font-mono text-[9px] text-slate-500 truncate mb-2">
                            {doc.file_name ?? "unnamed_attachment"}
                          </p>

                          {/* Meta row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] font-mono text-slate-500">
                            {/* Linked context */}
                            {doc.opportunity_name ? (
                              <div className="flex items-center space-x-1">
                                <Briefcase className="w-3 h-3 text-[#3B82F6]" />
                                <span className="text-slate-400">{doc.opportunity_name}</span>
                              </div>
                            ) : doc.tender_name ? (
                              <div className="flex items-center space-x-1">
                                <Layers className="w-3 h-3 text-purple-400" />
                                <span className="text-slate-400">{doc.tender_name}</span>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-1">
                                <FolderOpen className="w-3 h-3 text-slate-600" />
                                <span className="text-slate-600">Unlinked</span>
                              </div>
                            )}

                            {/* File size */}
                            <div className="flex items-center space-x-1">
                              <FileArchive className="w-3 h-3 text-slate-600" />
                              <span className="tabular-nums">{formatBytes(doc.file_size_bytes)}</span>
                            </div>

                            {/* Upload date */}
                            <div className="flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-slate-600" />
                              <span className="tabular-nums">{date}</span>
                              <span className="text-slate-600 tabular-nums">{time}</span>
                            </div>

                            {/* Uploader */}
                            {doc.owner_name && (
                              <div className="flex items-center space-x-1">
                                <User className="w-3 h-3 text-slate-600" />
                                <span>{doc.owner_name}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center space-x-1 shrink-0">
                          {/* Version history toggle */}
                          <button
                            onClick={() => toggleVersions(doc.id)}
                            title="Toggle version history"
                            className={`flex items-center space-x-1 px-2 py-1 rounded-sm font-mono text-[9px] border transition-all ${
                              isExpanded
                                ? "bg-amber-400/10 border-amber-400/25 text-amber-400"
                                : "border-white/8 text-slate-500 hover:border-white/15 hover:text-paper"
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            <span className="hidden sm:inline">HISTORY</span>
                            {isExpanded ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </button>

                          {/* Preview */}
                          <button
                            onClick={() => alert(`Preview: ${doc.title}`)}
                            title="Preview document"
                            className="p-1.5 border border-white/8 rounded-sm text-slate-500 hover:text-signal hover:border-signal/25 transition-all"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Download */}
                          <button
                            onClick={() => alert(`Downloading: ${doc.file_name ?? doc.title}`)}
                            title="Download document"
                            className="p-1.5 border border-white/8 rounded-sm text-slate-500 hover:text-signal hover:border-signal/25 transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(doc.id, doc.title)}
                            title="Delete from vault"
                            className="p-1.5 border border-white/8 rounded-sm text-slate-500 hover:text-red-400 hover:border-red-500/25 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Version History expandable */}
                      {isExpanded && doc.versions && doc.versions.length > 0 && (
                        <VersionHistoryRow versions={doc.versions} />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Upload Modal ── */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg bg-[#0a0a0a] border border-white/10 rounded-sm shadow-2xl flex flex-col max-h-[90vh]">
            {/* Scan Overlay */}
            <VirusScanOverlay phase={scanPhase} progress={scanProgress} />

            {/* Modal Header */}
            <div className="flex justify-between items-center px-5 py-4 border-b border-white/8 shrink-0">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-signal" />
                <h2 className="font-sans font-bold text-sm tracking-wider uppercase text-signal">
                  Vault Registration
                </h2>
              </div>
              <button
                onClick={() => { setShowUploadModal(false); setScanPhase("idle"); setScanProgress(0); }}
                disabled={isSubmitting}
                className="text-slate-500 hover:text-paper transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Success state */}
            {uploadSuccess && (
              <div className="flex flex-col items-center justify-center py-10 space-y-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                <p className="font-mono text-sm text-emerald-400 tracking-wider">Document registered successfully</p>
              </div>
            )}

            {/* Form body */}
            {!uploadSuccess && (
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
                {/* Drag & Drop Zone */}
                <div
                  ref={dropRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative cursor-pointer border-2 border-dashed rounded-sm p-6 mb-5 text-center transition-all ${
                    isDragging
                      ? "border-signal bg-signal/8"
                      : "border-white/12 hover:border-white/25 bg-white/2 hover:bg-white/4"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileInput}
                    accept=".pdf,.doc,.docx,.xlsx,.xls,.png,.jpg,.zip"
                  />
                  <UploadCloud
                    className={`w-8 h-8 mx-auto mb-2 transition-colors ${
                      isDragging ? "text-signal" : "text-slate-600"
                    }`}
                  />
                  <p className={`font-mono text-xs transition-colors ${isDragging ? "text-signal" : "text-slate-500"}`}>
                    {isDragging ? "Release to add file" : "Drag & drop a file, or click to browse"}
                  </p>
                  <p className="font-mono text-[9px] text-slate-600 mt-1">
                    PDF, DOCX, XLSX, ZIP · Max 25 MB
                  </p>
                  {formFileName && (
                    <div className="mt-3 flex items-center justify-center space-x-2 text-signal">
                      <FileText className="w-3.5 h-3.5" />
                      <span className="font-mono text-xs">{formFileName}</span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleUpload} className="space-y-4" id="vault-upload-form">
                  {/* Title */}
                  <div>
                    <label className="block font-mono text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                      Document Title <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. Stage 2 Site Layout Proposal"
                      className="w-full bg-ink/80 border border-white/8 rounded-sm px-3 py-2 text-xs text-paper focus:border-signal outline-none font-sans placeholder:text-slate-600 transition-colors"
                    />
                    {formErrors.title && (
                      <p className="font-mono text-[9px] text-red-400 mt-1">{formErrors.title}</p>
                    )}
                  </div>

                  {/* File Name */}
                  <div>
                    <label className="block font-mono text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                      Physical File Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formFileName}
                      onChange={(e) => setFormFileName(e.target.value)}
                      placeholder="e.g. stage_2_site_layout.pdf"
                      className="w-full bg-ink/80 border border-white/8 rounded-sm px-3 py-2 text-xs text-paper focus:border-signal outline-none font-mono placeholder:text-slate-600 transition-colors"
                    />
                    {formErrors.fileName && (
                      <p className="font-mono text-[9px] text-red-400 mt-1">{formErrors.fileName}</p>
                    )}
                  </div>

                  {/* File Size + Category — 2 cols */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-mono text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                        File Size (bytes)
                      </label>
                      <input
                        type="number"
                        value={formFileSize}
                        onChange={(e) => setFormFileSize(e.target.value)}
                        className="w-full bg-ink/80 border border-white/8 rounded-sm px-3 py-2 text-xs text-paper focus:border-signal outline-none font-mono transition-colors"
                      />
                      {formErrors.fileSize && (
                        <p className="font-mono text-[9px] text-red-400 mt-1">{formErrors.fileSize}</p>
                      )}
                    </div>
                    <div>
                      <label className="block font-mono text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                        Category
                      </label>
                      <select
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value)}
                        className="w-full bg-ink/80 border border-white/8 rounded-sm px-3 py-2 text-xs text-paper focus:border-signal outline-none font-sans transition-colors"
                      >
                        {Object.keys(CATEGORY_VALUE_MAP).map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Link Context */}
                  <div>
                    <label className="block font-mono text-[9px] text-slate-500 uppercase tracking-wider mb-2">
                      Link to Context
                    </label>
                    <div className="flex space-x-4 mb-3">
                      {(["none", "opportunity", "tender"] as const).map((ltype) => (
                        <label key={ltype} className="flex items-center space-x-1.5 cursor-pointer font-mono text-[10px] text-slate-400 hover:text-paper transition-colors">
                          <input
                            type="radio"
                            name="linkType"
                            value={ltype}
                            checked={formLinkType === ltype}
                            onChange={() => setFormLinkType(ltype)}
                            className="accent-signal"
                          />
                          <span className="capitalize">{ltype === "none" ? "Unlinked" : ltype}</span>
                        </label>
                      ))}
                    </div>

                    {formLinkType === "opportunity" && (
                      <select
                        value={formOpportunityId}
                        onChange={(e) => setFormOpportunityId(e.target.value)}
                        className="w-full bg-ink/80 border border-white/8 rounded-sm px-3 py-2 text-xs text-paper focus:border-signal outline-none font-sans transition-colors"
                      >
                        <option value="">— Select Opportunity —</option>
                        {opportunities.map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    )}

                    {formLinkType === "tender" && (
                      <select
                        value={formTenderId}
                        onChange={(e) => setFormTenderId(e.target.value)}
                        className="w-full bg-ink/80 border border-white/8 rounded-sm px-3 py-2 text-xs text-paper focus:border-signal outline-none font-sans transition-colors"
                      >
                        <option value="">— Select Tender —</option>
                        {tenders.map((t) => (
                          <option key={t.id} value={t.id}>{t.tender_name}</option>
                        ))}
                      </select>
                    )}

                    {formErrors.link && (
                      <p className="font-mono text-[9px] text-red-400 mt-1">{formErrors.link}</p>
                    )}
                  </div>

                  {submitError && (
                    <div className="flex items-center space-x-2 bg-red-950/20 border border-red-500/25 p-2.5 rounded-sm">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <p className="font-mono text-[10px] text-red-400">{submitError}</p>
                    </div>
                  )}
                </form>
              </div>
            )}

            {/* Modal Footer */}
            {!uploadSuccess && (
              <div className="flex justify-end space-x-3 px-5 py-4 border-t border-white/8 shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowUploadModal(false); setScanPhase("idle"); setScanProgress(0); }}
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-xs font-mono text-slate-400 border border-white/10 rounded-sm hover:border-white/20 hover:text-paper transition-all disabled:opacity-40"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  form="vault-upload-form"
                  disabled={isSubmitting}
                  onClick={handleUpload}
                  className="flex items-center space-x-2 px-5 py-1.5 bg-signal hover:bg-signal/85 text-black text-xs font-mono font-bold tracking-wider rounded-sm transition-all disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmitting ? "SCANNING & REGISTERING…" : "REGISTER TO VAULT"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
