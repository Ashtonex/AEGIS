"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  FileText,
  Download,
  X,
  Loader2,
  Plus,
  Trash2,
  Building2,
  CheckCircle2,
  AlertCircle,
  FileCheck,
} from "lucide-react";
import { generateSNCInvoicePdf, reserveInvoiceNumber } from "@/lib/api/invoices";
import { useAuth } from "@/lib/auth/AuthContext";

export interface InvoiceItem {
  item_no?: string;
  description: string;
  amount_excl_vat: number;
  already_pro_rated?: boolean;
}

export interface GenerateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: {
    invoiceType?: "PROFORMA INVOICE" | "TAX INVOICE";
    invoiceNumber?: string;
    subject?: string;
    clientName?: string;
    clientAddress?: string;
    clientVat?: string;
    clientTin?: string;
    quotationRef?: string;
    clientPo?: string;
    depositPercentage?: number;
    applyVat?: boolean;
    vatRate?: number;
    items?: InvoiceItem[];
    notes?: string[];
  };
}

export function GenerateInvoiceModal({
  isOpen,
  onClose,
  initialData,
}: GenerateInvoiceModalProps) {
  const { session } = useAuth();

  const [invoiceType, setInvoiceType] = useState<"PROFORMA INVOICE" | "TAX INVOICE">(
    initialData?.invoiceType || "PROFORMA INVOICE"
  );
  // Blank means "assign the next sequential USD number when downloading".
  const [invoiceNumber, setInvoiceNumber] = useState(initialData?.invoiceNumber || "");
  const [subject, setSubject] = useState(
    initialData?.subject || "40% deposit — Commercial Works & Execution"
  );
  const [clientName, setClientName] = useState(initialData?.clientName || "");
  const [clientAddress, setClientAddress] = useState(initialData?.clientAddress || "");
  const [clientVat, setClientVat] = useState(initialData?.clientVat || "");
  const [clientTin, setClientTin] = useState(initialData?.clientTin || "");
  const [quotationRef, setQuotationRef] = useState(initialData?.quotationRef || "");
  const [clientPo, setClientPo] = useState(initialData?.clientPo || "—");

  const [depositPct, setDepositPct] = useState<number>(
    initialData?.depositPercentage !== undefined ? initialData.depositPercentage : 40
  );
  const [applyVat, setApplyVat] = useState<boolean>(
    initialData?.applyVat !== undefined ? initialData.applyVat : true
  );
  const vatRate = initialData?.vatRate || 0.155;

  const [items, setItems] = useState<InvoiceItem[]>(
    initialData?.items && initialData.items.length > 0
      ? initialData.items
      : [{ item_no: "1", description: "", amount_excl_vat: 0 }]
  );

  const [notes, setNotes] = useState<string[]>(
    initialData?.notes || [
      `This proforma invoice covers the ${depositPct}% deposit on works set out in ${quotationRef ? `Quotation ${quotationRef}` : "the agreed quotation"}.`,
      "Please quote the invoice number as the reference on your payment.",
      "A fiscal tax invoice will be issued on receipt of payment.",
      "Ordering of materials and mobilisation to site begin on receipt of the full deposit.",
    ]
  );

  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialData) {
      if (initialData.invoiceType) setInvoiceType(initialData.invoiceType);
      if (initialData.invoiceNumber) setInvoiceNumber(initialData.invoiceNumber);
      if (initialData.subject) setSubject(initialData.subject);
      if (initialData.clientName) setClientName(initialData.clientName);
      if (initialData.clientAddress) setClientAddress(initialData.clientAddress);
      if (initialData.clientVat !== undefined) setClientVat(initialData.clientVat);
      if (initialData.clientTin !== undefined) setClientTin(initialData.clientTin);
      if (initialData.quotationRef) setQuotationRef(initialData.quotationRef);
      if (initialData.clientPo !== undefined) setClientPo(initialData.clientPo);
      if (initialData.depositPercentage !== undefined) setDepositPct(initialData.depositPercentage);
      if (initialData.applyVat !== undefined) setApplyVat(initialData.applyVat);
      if (initialData.items && initialData.items.length > 0) setItems(initialData.items);
      if (initialData.notes && initialData.notes.length > 0) setNotes(initialData.notes);
    }
  }, [isOpen, initialData]);

  // Financial calculations preview
  const calculations = useMemo(() => {
    let totExcl = 0;
    items.forEach((it) => {
      const amt = Number(it.amount_excl_vat) || 0;
      const effective = depositPct > 0 && !it.already_pro_rated ? amt * (depositPct / 100) : amt;
      totExcl += effective;
    });

    const totVat = applyVat ? totExcl * vatRate : 0;
    const totIncl = totExcl + totVat;

    return {
      subtotalExcl: totExcl,
      vatAmount: totVat,
      grandTotal: totIncl,
    };
  }, [items, depositPct, applyVat, vatRate]);

  if (!isOpen) return null;

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        item_no: String(prev.length + 1),
        description: "Additional project works or variation",
        amount_excl_vat: 0,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof InvoiceItem, value: any) => {
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleDownload = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!clientName.trim()) {
      setErrorMsg("Enter the client name before generating an official invoice.");
      return;
    }
    if (!items.some((item) => Number(item.amount_excl_vat) > 0)) {
      setErrorMsg("Add at least one line item with an amount greater than zero.");
      return;
    }
    setGenerating(true);

    let number = invoiceNumber.trim();
    if (!number) {
      try {
        number = await reserveInvoiceNumber(session?.access_token);
        setInvoiceNumber(number);
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to reserve an invoice number.");
        setGenerating(false);
        return;
      }
    }

    const payload = {
      invoice_type: invoiceType,
      invoice_number: number,
      subject,
      client_name: clientName,
      client_address: clientAddress,
      client_vat: clientVat,
      client_tin: clientTin,
      quotation_ref: quotationRef,
      client_po: clientPo,
      currency: "USD",
      deposit_percentage: depositPct,
      apply_vat: applyVat,
      vat_rate: vatRate,
      items,
      notes,
    };

    try {
      const blob = await generateSNCInvoicePdf(payload, session?.access_token);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SNC_${invoiceType.replace(/\s+/g, "_")}_${number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setSuccessMsg(`Official ${invoiceType} PDF generated and downloaded.`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to generate invoice PDF.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl border border-ink-mid bg-ink text-paper shadow-2xl max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-ink-mid px-6 py-4 bg-ink-light">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded border border-signal/40 bg-signal/10 text-signal">
              <FileText size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-paper">
                Six Nine Construction — Generate Official Invoice
              </h2>
              <p className="text-[11px] text-slate">
                Produces client-ready Proforma / Tax Invoice with SNC watermark &amp; corporate banking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate hover:text-paper transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="flex items-center gap-2 border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              <AlertCircle size={16} className="text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-2 border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Invoice Type & Reference */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                Document Type
              </label>
              <select
                value={invoiceType}
                onChange={(e) => setInvoiceType(e.target.value as any)}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal outline-none"
              >
                <option value="PROFORMA INVOICE">PROFORMA INVOICE</option>
                <option value="TAX INVOICE">TAX INVOICE</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                Invoice Number
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="Auto-assigned on download"
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                Deposit % Required
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={depositPct}
                onChange={(e) => setDepositPct(Number(e.target.value))}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                Quotation / Agreement Ref
              </label>
              <input
                type="text"
                value={quotationRef}
                onChange={(e) => setQuotationRef(e.target.value)}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal outline-none font-mono"
              />
            </div>
          </div>

          {/* Subject Line */}
          <div>
            <label className="block text-[10px] font-mono uppercase text-slate mb-1">
              Invoice Subject / Project Scope
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal outline-none font-medium"
              placeholder="e.g. 40% deposit — Troutbeck Canopy Tour & Zipline, Nyanga, Phases 1 and 2"
              required
            />
          </div>

          {/* Client Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-ink-mid bg-ink-light p-3.5">
            <div>
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                Client Legal Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper mb-2"
              />
              <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                Client Address &amp; Location
              </label>
              <textarea
                rows={2}
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper resize-none"
              />
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                  Client VAT Registration No.
                </label>
                <input
                  type="text"
                  value={clientVat}
                  onChange={(e) => setClientVat(e.target.value)}
                  className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                  Client TIN Number
                </label>
                <input
                  type="text"
                  value={clientTin}
                  onChange={(e) => setClientTin(e.target.value)}
                  className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">
                  Client Purchase Order Ref
                </label>
                <input
                  type="text"
                  value={clientPo}
                  onChange={(e) => setClientPo(e.target.value)}
                  className="w-full border border-ink-mid bg-ink px-2.5 py-1.5 text-xs text-paper font-mono"
                  placeholder="PO-XXXX or —"
                />
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono uppercase text-slate">Invoice Line Items</span>
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-signal hover:underline"
              >
                <Plus size={13} /> Add Line Item
              </button>
            </div>
            <div className="border border-ink-mid overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0B2B39] text-white font-semibold">
                  <tr>
                    <th className="p-2 w-12 text-center">#</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 w-32 text-right">Base Amount (USD)</th>
                    <th className="p-2 w-32 text-right">
                      {depositPct > 0 ? `${depositPct}% Deposit` : "Subtotal"}
                    </th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid bg-ink">
                  {items.map((it, idx) => {
                    const baseAmt = Number(it.amount_excl_vat) || 0;
                    const effectiveAmt =
                      depositPct > 0 && !it.already_pro_rated
                        ? baseAmt * (depositPct / 100)
                        : baseAmt;
                    return (
                      <tr key={idx} className="hover:bg-ink-light">
                        <td className="p-2 text-center font-mono text-slate-light">{idx + 1}</td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={it.description}
                            onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                            className="w-full bg-transparent border-0 border-b border-transparent hover:border-slate/40 focus:border-signal px-1 py-0.5 text-paper outline-none"
                            required
                          />
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={it.amount_excl_vat}
                            onChange={(e) =>
                              handleItemChange(idx, "amount_excl_vat", Number(e.target.value))
                            }
                            className="w-full text-right bg-transparent border-0 border-b border-transparent hover:border-slate/40 focus:border-signal px-1 py-0.5 font-mono text-paper outline-none"
                          />
                        </td>
                        <td className="p-2 text-right font-mono font-medium text-paper">
                          ${effectiveAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-2 text-center">
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="text-slate hover:text-rose-400"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Amount Due Summary Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-ink-mid bg-[#0B2B39] p-4 text-white">
            <div className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-light">
                Settlement &amp; VAT Configuration
              </span>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="modalApplyVat"
                  checked={applyVat}
                  onChange={(e) => setApplyVat(e.target.checked)}
                  className="rounded border-slate text-signal focus:ring-0"
                />
                <label htmlFor="modalApplyVat" className="text-xs cursor-pointer text-slate-200">
                  Apply Zimbabwe VAT (15.5%)
                </label>
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                Official SNC Watermark will be embedded into the PDF background.
              </p>
            </div>

            <div className="space-y-1.5 text-right font-mono text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Subtotal Excl. VAT:</span>
                <span>${calculations.subtotalExcl.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>VAT (15.5%):</span>
                <span>${calculations.vatAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-t border-slate-700 pt-1.5 font-bold text-sm text-[#38BDF8]">
                <span>Total Amount Due:</span>
                <span>${calculations.grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Invoice Notes / Operational Narrative */}
          <div className="border border-ink-mid bg-ink-light p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono uppercase text-slate tracking-wider">
                Operational Narrative &amp; Bank Settlement Notes (Tells the Job Story)
              </label>
              <button
                type="button"
                onClick={() => setNotes((prev) => [...prev, ""])}
                className="text-[11px] text-signal hover:underline inline-flex items-center gap-1 font-medium"
              >
                <Plus size={11} /> Add Note
              </button>
            </div>
            <div className="space-y-1.5">
              {notes.map((note, nIdx) => (
                <div key={nIdx} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-slate-light w-5 shrink-0 text-right">
                    {nIdx + 1}.
                  </span>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => {
                      const updated = [...notes];
                      updated[nIdx] = e.target.value;
                      setNotes(updated);
                    }}
                    className="w-full border border-ink-mid bg-ink px-2.5 py-1 text-xs text-paper focus:border-signal outline-none font-mono"
                    placeholder="Enter operational footnote, machine meter, or settlement details..."
                  />
                  {notes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setNotes(notes.filter((_, i) => i !== nIdx))}
                      className="text-slate hover:text-rose-400 p-1"
                      title="Remove note"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-ink-mid px-6 py-4 bg-ink-light">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate hover:text-paper transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={generating}
            className="inline-flex items-center gap-2 bg-signal px-5 py-2.5 text-xs font-bold text-ink hover:bg-signal/90 disabled:opacity-50 transition-colors shadow-lg shadow-signal/10"
          >
            {generating ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Compiling ReportLab PDF...
              </>
            ) : (
              <>
                <Download size={15} />
                Download Official SNC Invoice (PDF)
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
