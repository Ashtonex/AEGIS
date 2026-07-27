"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import {
  UploadCloud, Check, AlertTriangle, ArrowRight,
  RefreshCw, ChevronRight, Download
} from 'lucide-react';
import { importCrmCsv, importCrmVCard, downloadCrmCsvExport, getCrmContacts, getCrmLeads, getCrmOrganizations } from '@/lib/api';

type ImportTargetType = 'contacts' | 'leads' | 'organizations';
type ExportTargetType = 'contacts' | 'leads' | 'opportunities' | 'tickets';

interface ParsedPreview {
  headers: string[];
  rowCount: number;
  emails: string[];
}

interface DuplicateMatch {
  email: string;
  existingName?: string;
}

function parseCsvPreview(text: string): ParsedPreview {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rowCount: 0, emails: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const emailIdx = headers.findIndex((h) => /email/i.test(h));
  const emails: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (emailIdx >= 0) {
      const cols = lines[i].split(',');
      const email = (cols[emailIdx] || '').trim().toLowerCase();
      if (email) emails.push(email);
    }
  }
  return { headers, rowCount: lines.length - 1, emails };
}

function parseVCardPreview(text: string): ParsedPreview {
  const emails: string[] = [];
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('BEGIN:VCARD')) count += 1;
    if (line.startsWith('EMAIL') && line.includes(':')) {
      emails.push(line.split(':', 2)[1].trim().toLowerCase());
    }
  }
  return { headers: ['FN', 'EMAIL', 'TEL', 'TITLE'], rowCount: count, emails };
}

export default function ImportExportPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<'csv' | 'vcard' | null>(null);
  const [targetType, setTargetType] = useState<ImportTargetType>('contacts');
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [exportBusy, setExportBusy] = useState<ExportTargetType | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setError(null);
    const kind = selected.name.toLowerCase().endsWith('.vcf') ? 'vcard' : 'csv';
    setFile(selected);
    setFileKind(kind);
    const text = await selected.text();
    setPreview(kind === 'csv' ? parseCsvPreview(text) : parseVCardPreview(text));
    setStep(2);
  };

  const proceedToDuplicateCheck = async () => {
    if (!preview) return;
    setIsProcessing(true);
    setError(null);
    try {
      const existingRes = targetType === 'leads' ? await getCrmLeads() : targetType === 'organizations' ? await getCrmOrganizations() : await getCrmContacts();
      const existing: any[] = existingRes.success && Array.isArray(existingRes.data) ? existingRes.data : [];
      const existingByEmail = new Map<string, string | undefined>(
        existing
          .map((record): [string, string | undefined] => [
            String(record.email || record.contact_email || '').toLowerCase(),
            record.contact_name || record.name,
          ])
          .filter(([email]) => email)
      );
      const matches: DuplicateMatch[] = preview.emails
        .filter((email) => existingByEmail.has(email))
        .map((email) => ({ email, existingName: existingByEmail.get(email) }));
      setDuplicates(matches);
      setStep(3);
    } catch (err: any) {
      setError(err?.message || "Could not check for duplicates against the CRM database.");
    } finally {
      setIsProcessing(false);
    }
  };

  const completeImport = async () => {
    if (!file || !fileKind) return;
    setIsProcessing(true);
    setError(null);
    try {
      const response = fileKind === 'vcard' ? await importCrmVCard(file) : await importCrmCsv(file, targetType);
      if (!response.success) throw new Error(response.message || "Import failed.");
      setImportedCount(response.data?.imported ?? 0);
      setStep(4);
    } catch (err: any) {
      setError(err?.message || "Import failed. No records were written.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async (type: ExportTargetType) => {
    setExportBusy(type);
    try {
      const blob = await downloadCrmCsvExport(type);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${type}_export.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || `Export of ${type} failed.`);
    } finally {
      setExportBusy(null);
    }
  };

  const reset = () => {
    setFile(null);
    setFileKind(null);
    setPreview(null);
    setDuplicates([]);
    setImportedCount(null);
    setError(null);
    setStep(1);
  };

  return (
    <main className="min-h-screen bg-[#0A0D14] text-[#E2E8F0] p-4 lg:p-8 font-sans">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-[#1E293B] pb-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <UploadCloud className="h-6 w-6 text-[#3B82F6]" />
            CSV / vCard Database Import
          </h1>
          <p className="text-slate-400 text-xs mt-1">Import contacts or leads, preview detected duplicates, and export existing records.</p>
        </div>
        <div className="flex gap-2">
          <button
            disabled={exportBusy !== null}
            onClick={() => handleExport('contacts')}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-[#1E293B] text-slate-300 hover:border-[#3B82F6] hover:text-[#3B82F6] disabled:opacity-50"
          >
            {exportBusy === 'contacts' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Contacts
          </button>
          <button
            disabled={exportBusy !== null}
            onClick={() => handleExport('leads')}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-[#1E293B] text-slate-300 hover:border-[#3B82F6] hover:text-[#3B82F6] disabled:opacity-50"
          >
            {exportBusy === 'leads' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Leads
          </button>
          <button
            disabled={exportBusy !== null}
            onClick={() => handleExport('opportunities')}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-[#1E293B] text-slate-300 hover:border-[#3B82F6] hover:text-[#3B82F6] disabled:opacity-50"
          >
            {exportBusy === 'opportunities' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Opportunities
          </button>
          <button
            disabled={exportBusy !== null}
            onClick={() => handleExport('tickets')}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-[#1E293B] text-slate-300 hover:border-[#3B82F6] hover:text-[#3B82F6] disabled:opacity-50"
          >
            {exportBusy === 'tickets' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Tickets
          </button>
        </div>
      </div>

      {error && (
        <div className="max-w-3xl mx-auto mb-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex justify-between items-center bg-[#111827]/40 border border-[#1E293B]/60 p-4 rounded-xl mb-6 max-w-3xl mx-auto">
        {[
          { label: 'Upload File', s: 1 },
          { label: 'Preview & Target', s: 2 },
          { label: 'Resolve Duplicates', s: 3 },
          { label: 'Import Complete', s: 4 }
        ].map((item) => (
          <div key={item.s} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-bold ${
              step >= item.s ? 'bg-[#3B82F6] text-white' : 'bg-[#1E293B] text-slate-400'
            }`}>
              {item.s}
            </span>
            <span className={`text-xs hidden sm:inline ${step === item.s ? 'text-white font-bold' : 'text-slate-400'}`}>
              {item.label}
            </span>
            {item.s < 4 && <ChevronRight className="h-4 w-4 text-slate-600 hidden sm:block" />}
          </div>
        ))}
      </div>

      <div className="max-w-3xl mx-auto bg-[#111827]/30 border border-[#1E293B]/70 rounded-xl p-6 backdrop-blur-md">
        {step === 1 && (
          <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-[#1E293B] rounded-lg">
            <UploadCloud className="h-12 w-12 text-[#3B82F6] mb-4" />
            <p className="text-sm font-semibold text-white">Upload your contacts database file</p>
            <p className="text-xs text-slate-400 mt-1">Supports CSV, vCard (.vcf) formats.</p>
            <input type="file" accept=".csv,.vcf" onChange={handleFileUpload} id="file-upload" className="hidden" />
            <label htmlFor="file-upload" className="mt-6 px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-semibold rounded-lg cursor-pointer transition shadow-lg shadow-[#3B82F6]/20">
              Choose CSV or vCard File
            </label>
          </div>
        )}

        {step === 2 && preview && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-white">File Preview</h3>
            <p className="text-xs text-slate-400">
              Detected <span className="font-mono text-white font-semibold">{preview.rowCount}</span> record(s) in{' '}
              <span className="font-mono text-white font-semibold">{file?.name}</span>.
            </p>

            <div className="bg-[#111827]/50 border border-[#1E293B] p-4 rounded-lg space-y-2 text-xs">
              <p className="text-slate-400">Detected columns:</p>
              <div className="flex flex-wrap gap-2">
                {preview.headers.map((h) => (
                  <span key={h} className="px-2 py-0.5 rounded bg-[#0A0D14] border border-[#1E293B] font-mono text-slate-300">{h}</span>
                ))}
              </div>
            </div>

            {fileKind === 'csv' && (
              <div className="space-y-2">
                <label className="block text-xs text-slate-400">Import as</label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as ImportTargetType)}
                  className="bg-[#0A0D14] border border-[#1E293B] rounded p-2 text-white text-xs"
                >
                  <option value="contacts">Contacts</option>
                  <option value="leads">Leads</option>
                  <option value="organizations">Organizations</option>
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setStep(1)} className="px-4 py-2 border border-[#1E293B] rounded text-slate-400 hover:bg-[#1E293B] text-xs transition">
                Back
              </button>
              <button
                onClick={proceedToDuplicateCheck}
                disabled={isProcessing}
                className="px-4 py-2 bg-[#3B82F6] text-white text-xs font-semibold rounded hover:bg-[#2563EB] transition flex items-center gap-2"
              >
                {isProcessing && <RefreshCw className="h-4 w-4 animate-spin" />}
                Check for Duplicates
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-sm font-bold text-white">
                {duplicates.length > 0 ? `Possible Duplicates (${duplicates.length})` : "No Duplicates Detected"}
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              {duplicates.length > 0
                ? "These emails in the uploaded file already exist in the CRM. They will still be imported as new records unless you cancel."
                : "None of the detected emails match an existing CRM record."}
            </p>

            {duplicates.length > 0 && (
              <div className="space-y-2">
                {duplicates.map((dup) => (
                  <div key={dup.email} className="border border-[#1E293B] rounded-lg p-3 bg-[#111827]/70 flex justify-between text-xs">
                    <span className="font-mono text-slate-300">{dup.email}</span>
                    <span className="text-emerald-400">matches existing: {dup.existingName || "unknown"}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setStep(2)} className="px-4 py-2 border border-[#1E293B] rounded text-slate-400 hover:bg-[#1E293B] text-xs transition">
                Back
              </button>
              <button
                onClick={completeImport}
                disabled={isProcessing}
                className="px-4 py-2 bg-[#3B82F6] text-white text-xs font-semibold rounded hover:bg-[#2563EB] transition flex items-center gap-2"
              >
                {isProcessing && <RefreshCw className="h-4 w-4 animate-spin" />}
                Confirm & Import Records
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center justify-center py-10 space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Check className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-white">Import Process Completed</h3>
            <p className="text-xs text-slate-400 text-center max-w-sm">
              Imported <span className="text-white font-bold">{importedCount ?? 0}</span> new {fileKind === 'vcard' ? 'contact' : targetType} record(s).
            </p>
            <div className="flex gap-2 mt-6">
              <Link href={fileKind === 'vcard' || targetType === 'contacts' ? "/dashboard/crm/contacts" : targetType === 'organizations' ? "/dashboard/crm/organizations" : "/dashboard/crm/leads"} className="px-4 py-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-semibold rounded-lg transition">
                View Records
              </Link>
              <button onClick={reset} className="px-4 py-2 border border-[#1E293B] hover:bg-[#1E293B] text-slate-300 text-xs font-semibold rounded-lg transition">
                Import another file
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
