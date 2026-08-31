"use client";

import { useState, useRef } from "react";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, X, Shield, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VerifiedDocument {
  docType: "praz" | "zimra_tax" | "cr14" | "technical_proposal";
  fileName: string;
  fileSizeBytes: number;
  sha256Hash: string;
  status: "prepared" | "uploading" | "error";
  uploadedAt: string;
}

interface TenderSubmissionUploaderProps {
  onDocumentsChange: (docs: VerifiedDocument[]) => void;
  disabled?: boolean;
}

const REQUIRED_DOCS = [
  {
    type: "praz" as const,
    label: "PRAZ Annual Registration Certificate",
    sublabel: "Valid under the Public Procurement and Disposal of Public Assets Act",
    required: true,
  },
  {
    type: "zimra_tax" as const,
    label: "ZIMRA Valid Tax Clearance (ITF 263)",
    sublabel: "Current fiscal year clearance certificate with QR/verification code",
    required: true,
  },
  {
    type: "cr14" as const,
    label: "CR14 / CR6 & Incorporation Certificate",
    sublabel: "Registered directors and registered office address documentation",
    required: true,
  },
  {
    type: "technical_proposal" as const,
    label: "Technical Proposal & Priced BOQ",
    sublabel: "Methodology statement, plant schedule, and priced bill of quantities",
    required: true,
  },
];

async function calculateSHA256(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export function TenderSubmissionUploader({ onDocumentsChange, disabled }: TenderSubmissionUploaderProps) {
  const [documents, setDocuments] = useState<Record<string, VerifiedDocument>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRefs = {
    praz: useRef<HTMLInputElement>(null),
    zimra_tax: useRef<HTMLInputElement>(null),
    cr14: useRef<HTMLInputElement>(null),
    technical_proposal: useRef<HTMLInputElement>(null),
  };

  const handleFileSelect = async (docType: "praz" | "zimra_tax" | "cr14" | "technical_proposal", file: File) => {
    setErrorMsg(null);

    // Size limit: 25MB
    if (file.size > 25 * 1024 * 1024) {
      setErrorMsg(`File "${file.name}" exceeds maximum allowed size of 25MB.`);
      return;
    }

    // Format validation
    const validExtensions = ["pdf", "zip", "doc", "docx", "xls", "xlsx"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !validExtensions.includes(ext)) {
      setErrorMsg(`File "${file.name}" format not accepted. Please upload PDF, ZIP, or DOC/XLS files.`);
      return;
    }

    try {
      const hash = await calculateSHA256(file);
      const newDoc: VerifiedDocument = {
        docType,
        fileName: file.name,
        fileSizeBytes: file.size,
        sha256Hash: hash,
        status: "prepared",
        uploadedAt: new Date().toISOString(),
      };

      const updated = { ...documents, [docType]: newDoc };
      setDocuments(updated);
      onDocumentsChange(Object.values(updated));
    } catch {
      setErrorMsg("Failed to verify cryptographic document checksum. Please retry.");
    }
  };

  const handleRemoveDoc = (docType: string) => {
    const updated = { ...documents };
    delete updated[docType];
    setDocuments(updated);
    onDocumentsChange(Object.values(updated));
  };

  const preparedCount = Object.keys(documents).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-ink-mid pb-3">
        <div className="flex items-center gap-2 text-slate-light font-mono text-[12px] uppercase tracking-wider">
          <Shield className="w-4 h-4 text-signal" />
          <span>Statutory Document Readiness Checklist</span>
        </div>
        <span className={cn(
          "font-mono text-[11px] px-2 py-0.5 rounded border",
          preparedCount === 4
            ? "border-[#2ECC71]/40 bg-[#2ECC71]/10 text-[#2ECC71]"
            : "border-signal/40 bg-signal/10 text-signal"
        )}>
          {preparedCount} of 4 Prepared
        </span>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-[12px] font-mono flex items-center gap-2 rounded">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {REQUIRED_DOCS.map((req) => {
          const doc = documents[req.type];
          const isUploaded = !!doc && doc.status === "prepared";

          return (
            <div
              key={req.type}
              className={cn(
                "p-3.5 border rounded-[4px] transition-all relative flex flex-col justify-between",
                isUploaded
                  ? "border-[#2ECC71]/50 bg-ink-light"
                  : "border-dashed border-ink-mid bg-ink/60 hover:border-slate/40"
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-semibold text-[13px] text-paper leading-tight">{req.label}</span>
                  {isUploaded ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveDoc(req.type)}
                      className="text-slate hover:text-red-400 p-0.5"
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <span className="text-[10px] text-signal font-mono uppercase tracking-wider shrink-0">Required</span>
                  )}
                </div>
                <div className="text-[11px] text-slate font-mono leading-relaxed mb-3">
                  {req.sublabel}
                </div>
              </div>

              {isUploaded ? (
                <div className="bg-ink p-2 rounded border border-ink-mid flex items-center justify-between text-[11px] font-mono">
                  <div className="flex items-center gap-2 overflow-hidden text-slate-light">
                    <FileText className="w-3.5 h-3.5 text-[#2ECC71] shrink-0" />
                    <span className="truncate max-w-[140px]">{doc.fileName}</span>
                    <span className="text-slate text-[10px]">({Math.round(doc.fileSizeBytes / 1024)} KB)</span>
                  </div>
                  <span className="text-slate/60 text-[10px] tracking-tight">#{doc.sha256Hash}</span>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => fileInputRefs[req.type].current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-ink border border-ink-mid hover:border-signal text-slate-light hover:text-paper font-mono text-[11px] uppercase tracking-wider rounded transition-colors disabled:opacity-50"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-signal" />
                    <span>Attach Document</span>
                  </button>
                  <input
                    ref={fileInputRefs[req.type]}
                    type="file"
                    accept=".pdf,.zip,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileSelect(req.type, file);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-[10px] text-slate/70 font-mono pt-1">
        <Lock className="w-3.5 h-3.5 text-signal" />
        <span>Selected files are checked locally only. Documents are not uploaded during interest registration.</span>
      </div>
    </div>
  );
}
