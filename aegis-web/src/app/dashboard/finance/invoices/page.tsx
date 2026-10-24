"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  FileText,
  Download,
  Plus,
  Building2,
  DollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Search,
  Filter,
  Truck,
  HardHat,
  Briefcase,
  Layers,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { GenerateInvoiceModal } from "@/components/invoices/GenerateInvoiceModal";
import { generateSNCInvoicePdf } from "@/lib/api/invoices";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function FinanceInvoicesPage() {
  const { session } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<any>(null);
  const [downloadingSample, setDownloadingSample] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sampleUSD211Payload = {
    invoice_type: "PROFORMA INVOICE",
    invoice_number: "USD211",
    subject: "40% deposit — Troutbeck Canopy Tour & Zipline, Nyanga, Phases 1 and 2",
    client_name: "Gold Coast Properties (Pvt) Ltd",
    client_address: "Bally House, 870 Endeavor Crescent,\nMt Pleasant Business Park, Harare",
    client_vat: "220207665",
    client_tin: "2000039441",
    quotation_ref: "TCT-2026-014 Rev 1 (2 October 2026)",
    client_po: "—",
    currency: "USD",
    deposit_percentage: 40,
    apply_vat: true,
    vat_rate: 0.155,
    items: [
      {
        item_no: "1",
        description: "Phase 1 — Canopy tour. Scope of works as per contract bill of quantities",
        amount_excl_vat: 159108.90,
      },
      {
        item_no: "2",
        description: "Phase 2 — Main zipline. Scope of works as per contract bill of quantities",
        amount_excl_vat: 32171.32,
      },
    ],
    notes: [
      "This proforma invoice covers the 40% deposit on works set out in Quotation TCT-2026-014 Rev 1.",
      "Please quote USD211 as the reference on your payment.",
      "A fiscal tax invoice will be issued on receipt of payment.",
      "Ordering of materials and mobilisation to site begin on receipt of the full deposit.",
    ],
  };

  const sampleEHTRWPayload = {
    invoice_type: "PROFORMA INVOICE",
    invoice_number: "USD212",
    subject: "40% Advance Deposit — EHT-Roadworks & Paving Project (514 m²)",
    client_name: "Eastern Highlands Trust",
    client_address: "Eastern Highlands Estate, Mutare, Zimbabwe",
    client_vat: "220984112",
    client_tin: "2000184920",
    quotation_ref: "QT-EHTRW-2026-001 (17 October 2026)",
    client_po: "PO-EHT-2026-09",
    currency: "USD",
    deposit_percentage: 40,
    apply_vat: true,
    vat_rate: 0.155,
    items: [
      {
        item_no: "1",
        description: "Sub-base gravel compaction, kerbing, and 29,700 60mm paver surfacing across 514 m²",
        amount_excl_vat: 18275.90,
      },
    ],
    notes: [
      "This proforma invoice covers the 40% advance deposit on roadworks set out in Quotation QT-EHTRW-2026-001.",
      "Please quote USD212 as the reference on your payment.",
      "A fiscal tax invoice will be issued on receipt of payment.",
      "Plant mobilisation and subgrade formation completed on site.",
    ],
  };

  const samplePlantPayload = {
    invoice_type: "TAX INVOICE",
    invoice_number: "USD213",
    subject: "Plant & Equipment Hire — Bomag BW 120 Roller & Compactor Fleet Job",
    client_name: "Eastern Highlands Trust / Civil Works",
    client_address: "Mutare Site Sector A, Manicaland",
    client_vat: "220984112",
    client_tin: "2000184920",
    quotation_ref: "HA-EHTRW-2026-001",
    client_po: "PO-PLANT-881",
    currency: "USD",
    deposit_percentage: 0,
    apply_vat: true,
    vat_rate: 0.155,
    items: [
      {
        item_no: "1",
        description: "Bomag BW 120 Smooth Drum Roller — 32 operating hours @ $85/hr (Sub-base compaction)",
        amount_excl_vat: 2720.00,
      },
      {
        item_no: "2",
        description: "Reversible Plate Compactor — 4 days wet hire with operator @ $120/day",
        amount_excl_vat: 480.00,
      },
      {
        item_no: "3",
        description: "Low-bed Plant Mobilisation & Return Demobilisation to Mutare Site",
        amount_excl_vat: 350.00,
      },
    ],
    notes: [
      "Tax invoice for plant hire and telematics-verified machine hours on site.",
      "Machine switch approved by Plant Manager and Executive under verified equipment logs.",
      "Payment terms: strictly 7 days from invoice date.",
    ],
  };

  const handleQuickDownload = async (key: string, payload: any, filename: string) => {
    setDownloadingSample(key);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const blob = await generateSNCInvoicePdf(payload, session?.access_token);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setSuccessMsg(`Successfully generated and downloaded: ${filename}`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to download invoice PDF.");
    } finally {
      setDownloadingSample(null);
    }
  };

  // The sample payloads use the API's snake_case keys; the builder modal takes camelCase props.
  const openBuilder = (initial?: any) => {
    setModalData(
      initial
        ? {
            invoiceType: initial.invoice_type,
            invoiceNumber: initial.invoice_number,
            subject: initial.subject,
            clientName: initial.client_name,
            clientAddress: initial.client_address,
            clientVat: initial.client_vat,
            clientTin: initial.client_tin,
            quotationRef: initial.quotation_ref,
            clientPo: initial.client_po,
            depositPercentage: initial.deposit_percentage,
            applyVat: initial.apply_vat,
            vatRate: initial.vat_rate,
            items: initial.items,
            notes: initial.notes,
          }
        : null
    );
    setModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="border border-ink-mid bg-ink p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase px-2 py-0.5 border border-signal/40 bg-signal/10 text-signal font-bold">
                Six Nine Construction
              </span>
              <span className="font-mono text-xs uppercase px-2 py-0.5 border border-emerald-500/40 bg-emerald-950/20 text-emerald-400 font-bold">
                Watermarked Corporate Layout
              </span>
            </div>
            <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-paper">
              Official Invoices &amp; Billing Desk
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-light max-w-3xl">
              Produces verified, beautifully aligned Proforma &amp; Fiscal Tax Invoices featuring the official SNC watermark,
              Banc ABC settlement details, ZIMRA 15.5% tax calculations, and storytelling job narratives across Projects, CRM, Quotations, and Plant Hire.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => openBuilder()}
              className="inline-flex items-center gap-2 border border-signal bg-signal px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-all shadow-md active:scale-95"
            >
              <Plus className="h-4 w-4" />
              <span>Create Custom Invoice</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>

      {/* 3 Ready-to-Download Official Template Cards */}
      <div>
        <h2 className="font-mono text-xs uppercase font-bold text-slate-light tracking-wider mb-3">
          1-Click Instant Download — Official Formats
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Card 1: The Requested Sample USD211 */}
          <div className="border-2 border-signal/80 bg-gradient-to-b from-ink-light/40 to-ink p-5 rounded-xs space-y-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase px-2 py-0.5 border border-signal/60 bg-signal/20 text-signal font-bold">
                PROFORMA INVOICE
              </span>
              <span className="font-mono text-xs font-bold text-paper">No. USD211</span>
            </div>

            <div>
              <h3 className="font-display text-base font-bold text-paper">
                Troutbeck Canopy Tour &amp; Zipline
              </h3>
              <p className="font-mono text-xs text-slate-light mt-0.5">
                Client: Gold Coast Properties (Pvt) Ltd
              </p>
            </div>

            <div className="p-3 border border-ink-mid/60 bg-ink/70 space-y-1 font-mono text-[11px]">
              <div className="flex justify-between text-slate-light">
                <span>Total Scope (Phases 1 &amp; 2):</span>
                <span className="text-paper">$191,280.22</span>
              </div>
              <div className="flex justify-between text-slate-light">
                <span>Deposit Rate:</span>
                <span className="text-paper">40%</span>
              </div>
              <div className="flex justify-between text-signal font-bold border-t border-ink-mid/40 pt-1">
                <span>Amount Due (incl. VAT):</span>
                <span>$88,371.46</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={downloadingSample === "usd211"}
                onClick={() => handleQuickDownload("usd211", sampleUSD211Payload, "SNC_PROFORMA_INVOICE_USD211.pdf")}
                className="flex-1 inline-flex items-center justify-center gap-2 border border-signal bg-signal px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-all disabled:opacity-50"
              >
                {downloadingSample === "usd211" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => openBuilder(sampleUSD211Payload)}
                className="border border-ink-mid bg-ink-light px-3 py-2 font-mono text-xs text-slate-light hover:text-paper hover:border-signal transition-colors"
                title="Edit in Live Builder"
              >
                Edit
              </button>
            </div>
          </div>

          {/* Card 2: EHT-Roadworks Project Invoice */}
          <div className="border border-ink-mid bg-gradient-to-b from-ink-light/20 to-ink p-5 rounded-xs space-y-4 shadow-md">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase px-2 py-0.5 border border-sky-500/40 bg-sky-950/20 text-sky-400 font-bold">
                PROFORMA INVOICE
              </span>
              <span className="font-mono text-xs font-bold text-paper">No. USD212</span>
            </div>

            <div>
              <h3 className="font-display text-base font-bold text-paper">
                EHT-Roadworks &amp; Paving (514 m²)
              </h3>
              <p className="font-mono text-xs text-slate-light mt-0.5">
                Client: Eastern Highlands Trust
              </p>
            </div>

            <div className="p-3 border border-ink-mid/60 bg-ink/70 space-y-1 font-mono text-[11px]">
              <div className="flex justify-between text-slate-light">
                <span>Contract Value:</span>
                <span className="text-paper">$18,275.90</span>
              </div>
              <div className="flex justify-between text-slate-light">
                <span>Advance Mobilisation Deposit:</span>
                <span className="text-paper">40%</span>
              </div>
              <div className="flex justify-between text-sky-400 font-bold border-t border-ink-mid/40 pt-1">
                <span>Amount Due (incl. VAT):</span>
                <span>$8,443.47</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={downloadingSample === "ehtrw"}
                onClick={() => handleQuickDownload("ehtrw", sampleEHTRWPayload, "SNC_PROFORMA_INVOICE_EHTRW_USD212.pdf")}
                className="flex-1 inline-flex items-center justify-center gap-2 border border-sky-500/80 bg-sky-950/30 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-sky-300 hover:bg-sky-500 hover:text-ink transition-all disabled:opacity-50"
              >
                {downloadingSample === "ehtrw" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => openBuilder(sampleEHTRWPayload)}
                className="border border-ink-mid bg-ink-light px-3 py-2 font-mono text-xs text-slate-light hover:text-paper hover:border-signal transition-colors"
                title="Edit in Live Builder"
              >
                Edit
              </button>
            </div>
          </div>

          {/* Card 3: Plant & Equipment Storytelling Hire Invoice */}
          <div className="border border-ink-mid bg-gradient-to-b from-ink-light/20 to-ink p-5 rounded-xs space-y-4 shadow-md">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase px-2 py-0.5 border border-emerald-500/40 bg-emerald-950/20 text-emerald-400 font-bold">
                TAX INVOICE
              </span>
              <span className="font-mono text-xs font-bold text-paper">No. USD213</span>
            </div>

            <div>
              <h3 className="font-display text-base font-bold text-paper">
                Plant Hire: Bomag Roller &amp; Compactor
              </h3>
              <p className="font-mono text-xs text-slate-light mt-0.5">
                Client: Civil Works Sub-base Operations
              </p>
            </div>

            <div className="p-3 border border-ink-mid/60 bg-ink/70 space-y-1 font-mono text-[11px]">
              <div className="flex justify-between text-slate-light">
                <span>Operating Machine Telematics:</span>
                <span className="text-paper">32 Hours Roller + 4 Days</span>
              </div>
              <div className="flex justify-between text-slate-light">
                <span>Subtotal Excl. Tax:</span>
                <span className="text-paper">$3,550.00</span>
              </div>
              <div className="flex justify-between text-emerald-400 font-bold border-t border-ink-mid/40 pt-1">
                <span>Total Due (incl. 15.5% VAT):</span>
                <span>$4,100.25</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={downloadingSample === "plant"}
                onClick={() => handleQuickDownload("plant", samplePlantPayload, "SNC_TAX_INVOICE_PLANT_USD213.pdf")}
                className="flex-1 inline-flex items-center justify-center gap-2 border border-emerald-500/80 bg-emerald-950/30 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500 hover:text-ink transition-all disabled:opacity-50"
              >
                {downloadingSample === "plant" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => openBuilder(samplePlantPayload)}
                className="border border-ink-mid bg-ink-light px-3 py-2 font-mono text-xs text-slate-light hover:text-paper hover:border-signal transition-colors"
                title="Edit in Live Builder"
              >
                Edit
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Corporate Compliance & Banking Details Banner */}
      <div className="border border-ink-mid bg-ink p-5">
        <h3 className="font-mono text-xs uppercase font-bold text-paper mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-signal" />
          Official Corporate Details Printed on All Invoices
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono text-slate-light">
          <div className="space-y-1">
            <span className="text-paper font-semibold block">Company Registry</span>
            <p>Six Nine Construction (Pvt) Ltd</p>
            <p>Incorporation: 11284/2019</p>
            <p>VAT Reg: 220116087 | TIN: 2001309644</p>
            <p>ZIMRA Tax Clearance: ITF263 Active</p>
          </div>
          <div className="space-y-1">
            <span className="text-paper font-semibold block">Corporate Banking</span>
            <p className="text-signal font-bold">Banc ABC</p>
            <p>Branch: 117 (Southerton)</p>
            <p>Account No: 54925046633016</p>
            <p>Currency: United States Dollars (USD)</p>
          </div>
          <div className="space-y-1">
            <span className="text-paper font-semibold block">Headquarters &amp; Contacts</span>
            <p>No. 4 Kariba Road, Nyakamete Industrial Area</p>
            <p>Mutare, Manicaland, Zimbabwe</p>
            <p>Phone: +263 77 100 1750 / +263 77 100 1577</p>
            <p>Email: info@snc.co.zw | Web: snc.co.zw</p>
          </div>
        </div>
      </div>

      {/* Generate Invoice Modal */}
      {modalOpen && (
        <GenerateInvoiceModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          initialData={modalData}
        />
      )}
    </div>
  );
}
