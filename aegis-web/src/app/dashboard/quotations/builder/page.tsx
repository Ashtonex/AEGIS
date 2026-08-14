"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { 
  FileText, Plus, Trash2, Printer, CheckCircle, 
  AlertCircle, Loader2, Sliders, ArrowLeft, Download, 
  Upload, Layers, Coins, HelpCircle, Save, Info, BookOpen,
  Sparkles
} from "lucide-react";
import { getInternalProjects, getQuotation, createQuotation, updateQuotation, calculateQuotation, getDrawingRevisionAsBoq, importBoqFile, getFinanceActiveRateTable } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthContext";
import RuthlessCalculator from "./RuthlessCalculator";

interface LineItem {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  buildup?: Array<{
    type: "material" | "labour" | "equipment" | "subcontractor" | "transport" | "waste_allowance";
    name: string;
    qty: number;
    unit: string;
    rate: number;
  }>;
}

export default function QuotationBuilder() {
  const { session } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const editId = searchParams ? searchParams.get("edit") : null;
  const fromDrawingId = searchParams ? searchParams.get("from_drawing") : null;

  // Project selector list
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  // Form states
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [validDays, setValidDays] = useState(30);
  const [currency, setCurrency] = useState("USD");
  const [terms, setTerms] = useState("50% Mobilization, 40% Progress Claims, 10% Retention.");
  
  // Formulas & Markup
  const [preliminaries, setPreliminaries] = useState(0);
  const [overheadPct, setOverheadPct] = useState(5);
  const [contingencyPct, setContingencyPct] = useState(5);
  const [profitPct, setProfitPct] = useState(12);
  const [applyVat, setApplyVat] = useState(true);
  const DEFAULT_VAT_RATE = 0.15;
  const [vatRate, setVatRate] = useState(DEFAULT_VAT_RATE);
  const [vatRateIsConfigured, setVatRateIsConfigured] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [provisionalSums, setProvisionalSums] = useState(0);
  const [builtAreaSqm, setBuiltAreaSqm] = useState(0);
  const [isInflationAdjusted, setIsInflationAdjusted] = useState(false);
  const [revisionNumber, setRevisionNumber] = useState(1);
  const [assumptionsText, setAssumptionsText] = useState("");
  const [exclusionsText, setExclusionsText] = useState("");

  // Cost items table - starts with one blank editable row (matches addLineItem's
  // shape) rather than a fabricated example, since a user who doesn't notice and
  // clear a pre-filled row could save it as a real line item on the quotation.
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", qty: 1, unit: "unit", rate: 0, buildup: [] }
  ]);

  // Rate Buildup Modal State
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [tempBuildup, setTempBuildup] = useState<any[]>([]);
  const [showRuthlessCalc, setShowRuthlessCalc] = useState(false);

  // CSV paste importer state
  const [csvText, setCsvText] = useState("");
  const [showImporter, setShowImporter] = useState(false);

  // Excel/CSV file importer state (backend BOQImporter service)
  const [importingBoqFile, setImportingBoqFile] = useState(false);
  const boqFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Status & notifications
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // PDF & Excel generator Preview modal state
  const [printQuoteData, setPrintQuoteData] = useState<any | null>(null);
  const [printType, setPrintType] = useState<"quotation" | "boq" | "schedule">("quotation");

  // Load project options and populate edit fields if in edit mode
  useEffect(() => {
    async function loadInitial() {
      setLoading(true);
      setErrorMsg("");
      try {
        const projRes = await getInternalProjects();
        if (projRes.success && Array.isArray(projRes.data)) {
          setProjectsList(projRes.data);
        }

        if (editId) {
          const res = await getQuotation(editId);
          if (res.success && res.data) {
            const q = res.data;
            setClientName(q.client_name || "");
            setSelectedProjectId(q.project_id || "");
            
            // Populate meta details
            const meta = q.metadata || {};
            setClientEmail(meta.client_email || "");
            setProjectTitle(meta.project_title || "");
            setQuoteRef(meta.reference_number || "");
            setQuoteDate(meta.quote_date || "");
            setValidDays(Number(meta.valid_until_days) || 30);
            setCurrency(meta.currency || "USD");
            setTerms(meta.terms || "");
            setPreliminaries(Number(meta.preliminaries) || 0);
            setOverheadPct(Number(meta.overhead_pct) || 5);
            setContingencyPct(Number(meta.contingency_pct) || 5);
            setProfitPct(Number(meta.profit_pct) || 12);
            setApplyVat(meta.apply_vat !== false);
            setDiscount(Number(meta.discount) || 0);
            setProvisionalSums(Number(meta.provisional_sums) || 0);
            setBuiltAreaSqm(Number(meta.built_area_sqm) || 0);
            setIsInflationAdjusted(Boolean(meta.is_inflation_adjusted));
            setRevisionNumber(Number(meta.revision_number) || 1);
            setAssumptionsText(Array.isArray(meta.assumptions) ? meta.assumptions.join("\n") : "");
            setExclusionsText(Array.isArray(meta.exclusions) ? meta.exclusions.join("\n") : "");
            if (Array.isArray(meta.items)) {
              setLineItems(meta.items);
            }
          }
        } else {
          // Default fresh quote ref
          setQuoteRef(`SNC-QT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);
          setQuoteDate(new Date().toISOString().split("T")[0]);
        }
      } catch (err: any) {
        setErrorMsg("Failed to load initial data from API.");
      } finally {
        setLoading(false);
      }
    }

    if (session) {
      void loadInitial();
    }
  }, [session, editId]);

  // Real ZIMRA VAT rate, when configured via Finance > Statutory > Rate Tables.
  // Falls back to the historical 15% default so existing quoting behaviour
  // doesn't silently change until the org enters a real rate table.
  useEffect(() => {
    let cancelled = false;
    async function loadVatRate() {
      try {
        const res = await getFinanceActiveRateTable("vat_output", currency || "USD");
        const band = res.data?.bands?.[0];
        if (!cancelled && band && band.rate_pct != null) {
          setVatRate(Number(band.rate_pct) / 100);
          setVatRateIsConfigured(true);
        } else if (!cancelled) {
          setVatRate(DEFAULT_VAT_RATE);
          setVatRateIsConfigured(false);
        }
      } catch {
        if (!cancelled) {
          setVatRate(DEFAULT_VAT_RATE);
          setVatRateIsConfigured(false);
        }
      }
    }
    if (session) {
      void loadVatRate();
    }
    return () => {
      cancelled = true;
    };
  }, [session, currency]);

  // Hand-off from the Drawing Takeoff page: append that revision's measured
  // quantities as new BOQ lines (rate 0 - a drawing gives quantities, not
  // prices, so the estimator still has to price each row).
  useEffect(() => {
    async function loadFromDrawing() {
      if (!fromDrawingId) return;
      try {
        const res = await getDrawingRevisionAsBoq(fromDrawingId);
        if (res.success && Array.isArray(res.data?.items) && res.data.items.length > 0) {
          setLineItems((prev) => {
            const existingIsBlank = prev.length === 1 && !prev[0].description && prev[0].rate === 0;
            const base = existingIsBlank ? [] : prev;
            return [...base, ...res.data!.items.map((it: any) => ({ ...it, buildup: [] }))];
          });
          setSuccessMsg(`Loaded ${res.data.items.length} measurement(s) from the drawing takeoff. Add rates before saving.`);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to load measurements from the drawing takeoff.");
      }
    }
    if (session) void loadFromDrawing();
  }, [session, fromDrawingId]);

  // Mathematics buildup - MUST mirror QuotationCalculator.calculate() in
  // imperium-api/app/services/quotations/calculator.py exactly, or this live
  // preview disagrees with the number that actually gets saved/exported.
  // Backend: overhead/contingency/profit are each a % of (direct_costs +
  // preliminaries) independently - profit is NOT compounded on top of
  // overhead/contingency.
  const directCosts = lineItems.reduce((acc, item) => acc + item.qty * item.rate, 0);
  const totalDirectAndPrelims = directCosts + preliminaries;
  const overheadAmount = totalDirectAndPrelims * (overheadPct / 100);
  const contingencyAmount = totalDirectAndPrelims * (contingencyPct / 100);
  const profitAmount = totalDirectAndPrelims * (profitPct / 100);
  const subtotalBeforeProfit = totalDirectAndPrelims + overheadAmount + contingencyAmount;
  // Backend: subtotal includes provisional sums, THEN discount is applied
  // before tax (taxable_amount = max(0, subtotal - discount)).
  const subtotal = subtotalBeforeProfit + profitAmount + provisionalSums;
  const taxableAmount = Math.max(0, subtotal - discount);
  const vat = applyVat ? taxableAmount * vatRate : 0;
  const grandTotal = taxableAmount + vat;

  // Margin-policy and benchmark alerts - MUST mirror the checks in
  // QuotationCalculator.calculate() (calculator.py) so what the estimator
  // sees here matches what the backend actually flags on save/export.
  const warnings: string[] = [];
  if (profitPct / 100 > 0.40) {
    warnings.push("Profit rate exceeds maximum corporate threshold of 40%.");
  }
  if (overheadPct / 100 > 0.25) {
    warnings.push("Overhead rate exceeds maximum corporate threshold of 25%.");
  }
  if (builtAreaSqm > 0) {
    const finishedPricePerSqm = grandTotal / builtAreaSqm;
    if (finishedPricePerSqm < 450) {
      warnings.push(`Finished price of $${finishedPricePerSqm.toFixed(2)}/m² is below the standard corporate benchmark range ($450 - $800/m²). Ensure cost recovery is sufficient.`);
    } else if (finishedPricePerSqm > 800) {
      warnings.push(`Finished price of $${finishedPricePerSqm.toFixed(2)}/m² exceeds the standard corporate benchmark range ($450 - $800/m²). Review premium finish specification or markup.`);
    }
  }
  if (!isInflationAdjusted) {
    warnings.push("Pricing represents historical rates and has not been inflation-adjusted for current material price fluctuations. Recommend review against cost catalog.");
  }

  // Add line items
  const addLineItem = () => {
    setLineItems((prev) => [...prev, { description: "", qty: 1, unit: "unit", rate: 0, buildup: [] }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length === 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLineItemChange = (index: number, field: keyof LineItem, value: any) => {
    setLineItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // CSV importer
  const parseBOQText = () => {
    if (!csvText.trim()) return;
    const lines = csvText.split("\n");
    const parsed: LineItem[] = [];
    
    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      // support tab or comma separators
      const parts = rawLine.split(/[,\t]/);
      if (parts.length >= 2) {
        const desc = parts[0].replace(/^["']|["']$/g, "").trim();
        const qty = parseFloat(parts[1]) || 1;
        const unit = parts[2] ? parts[2].trim() : "unit";
        const rate = parts[3] ? parseFloat(parts[3]) : 0;
        parsed.push({
          description: desc,
          qty,
          unit,
          rate,
          buildup: []
        });
      }
    }

    if (parsed.length > 0) {
      setLineItems(parsed);
      setSuccessMsg(`Successfully parsed and loaded ${parsed.length} BOQ items.`);
      setCsvText("");
      setShowImporter(false);
    } else {
      setErrorMsg("Failed to parse BOQ text. Make sure rows are formatted as: Description, Quantity, [Unit], [Rate]");
    }
  };

  // Excel/CSV file importer - uses the backend BOQImporter service (handles
  // real spreadsheet column-header mapping, unlike the manual paste importer
  // above which only understands a fixed comma/tab column order).
  const handleBoqFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportingBoqFile(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await importBoqFile(file);
      const items = res.data?.items || [];
      if (items.length > 0) {
        setLineItems(
          items.map((it: any) => ({
            description: it.description,
            qty: Number(it.quantity) || 0,
            unit: it.unit || "unit",
            rate: Number(it.rate) || 0,
            buildup: [],
          }))
        );
        const warnings = res.data?.warnings || [];
        setSuccessMsg(
          `Imported ${items.length} BOQ item(s) from ${file.name}.` +
          (warnings.length > 0 ? ` ${warnings.length} row warning(s) - review before saving.` : "")
        );
      } else {
        setErrorMsg((res.data?.warnings || []).join(" ") || `No usable rows found in ${file.name}.`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to import BOQ file.");
    } finally {
      setImportingBoqFile(false);
    }
  };

  // Cost rate buildup sub-modal
  const openRateBuilder = (index: number) => {
    setSelectedRowIndex(index);
    setTempBuildup(lineItems[index].buildup || []);
  };

  const addBuildupRow = () => {
    setTempBuildup((prev) => [...prev, { type: "material", name: "", qty: 1, unit: "unit", rate: 0 }]);
  };

  const removeBuildupRow = (idx: number) => {
    setTempBuildup((prev) => prev.filter((_, i) => i !== idx));
  };

  const saveRateBuildup = () => {
    if (selectedRowIndex === null) return;
    const computedUnitRate = tempBuildup.reduce((acc, item) => acc + item.qty * item.rate, 0);
    setLineItems((prev) => {
      const copy = [...prev];
      copy[selectedRowIndex] = {
        ...copy[selectedRowIndex],
        rate: Number(computedUnitRate.toFixed(2)),
        buildup: tempBuildup
      };
      return copy;
    });
    setSelectedRowIndex(null);
    setShowRuthlessCalc(false);
  };

  // Save Quotation to PostgreSQL
  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !projectTitle || lineItems.some(i => !i.description)) {
      setErrorMsg("Please fill out all required fields and item descriptions.");
      return;
    }

    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    // An edit to an already-saved quotation is a new revision; a first save
    // is revision 1.
    const nextRevisionNumber = editId ? revisionNumber + 1 : 1;
    const assumptionsList = assumptionsText.split("\n").map((s) => s.trim()).filter(Boolean);
    const exclusionsList = exclusionsText.split("\n").map((s) => s.trim()).filter(Boolean);

    // Compute the real tamper-evidence hash server-side (QuotationCalculator
    // is the source of truth for it) so it's persisted on every save, not
    // just when the Builder's PDF/Excel export happens to be used.
    let auditTrailHash: string | undefined;
    try {
      const sumBuildupByType = (item: LineItem, type: string): number =>
        (item.buildup || [])
          .filter((b) => b.type === type)
          .reduce((acc, b) => acc + (Number(b.qty) || 0) * (Number(b.rate) || 0), 0);

      const calcRes = await calculateQuotation({
        quotation_id: quoteRef,
        revision_number: nextRevisionNumber,
        currency_rounding_decimals: 2,
        preliminaries,
        overhead_rate: overheadPct / 100,
        contingency_rate: contingencyPct / 100,
        profit_rate: profitPct / 100,
        discount,
        tax_rate: applyVat ? vatRate : 0,
        provisional_sums: provisionalSums,
        built_area_sqm: builtAreaSqm,
        price_validity_days: validDays,
        is_inflation_adjusted: isInflationAdjusted,
        assumptions: assumptionsList,
        exclusions: exclusionsList,
        items: lineItems.map((item) => ({
          description: item.description,
          quantity: item.qty,
          rate: item.rate,
          unit: item.unit,
          material_rate: sumBuildupByType(item, "material"),
          labour_rate: sumBuildupByType(item, "labour"),
          equipment_rate: sumBuildupByType(item, "equipment"),
          subcontractor_rate: sumBuildupByType(item, "subcontractor"),
          transport_rate: sumBuildupByType(item, "transport"),
          waste_allowance_rate: sumBuildupByType(item, "waste_allowance"),
        })),
      });
      auditTrailHash = calcRes.data?.audit_trail_hash;
    } catch {
      // Non-blocking: if the calculation service is unreachable, the
      // quotation still saves - it just keeps the "no hash" placeholder
      // until the next successful save.
    }

    const payload: any = {
      client_name: clientName,
      quote_amount: Number(grandTotal.toFixed(2)),
      status: "draft",
      metadata: {
        client_email: clientEmail,
        project_title: projectTitle,
        reference_number: quoteRef,
        quote_date: quoteDate,
        valid_until: new Date(new Date(quoteDate).getTime() + validDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        valid_until_days: validDays,
        currency,
        direct_costs: directCosts,
        preliminaries,
        overhead_pct: overheadPct,
        contingency_pct: contingencyPct,
        profit_pct: profitPct,
        overhead_amount: overheadAmount,
        contingency_amount: contingencyAmount,
        profit_amount: profitAmount,
        discount,
        provisional_sums: provisionalSums,
        built_area_sqm: builtAreaSqm,
        is_inflation_adjusted: isInflationAdjusted,
        revision_number: nextRevisionNumber,
        subtotal,
        taxable_amount: taxableAmount,
        vat,
        grand_total: grandTotal,
        apply_vat: applyVat,
        terms,
        assumptions: assumptionsList,
        exclusions: exclusionsList,
        items: lineItems,
        audit_trail_hash: auditTrailHash,
      }
    };

    if (selectedProjectId) {
      payload.project_id = selectedProjectId;
    }

    try {
      let res;
      if (editId) {
        res = await updateQuotation(editId, payload);
      } else {
        res = await createQuotation(payload);
      }

      if (res.success) {
        setSuccessMsg(`Quotation saved successfully! Reference: ${quoteRef}`);
        setPrintQuoteData({ ...payload, id: res.data?.id || editId });
        setRevisionNumber(nextRevisionNumber);

        // If it's a new quote, redirect to the overview after a delay, or keep showing preview
        if (!editId) {
          router.push(`/dashboard/quotations/builder?edit=${res.data?.id}`);
        }
      } else {
        setErrorMsg(res.message || "Failed to save quotation.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save. Database might be syncing.");
    } finally {
      setSubmitting(false);
    }
  };

  // Browser Print Preview trigger
  const handlePrint = () => {
    window.print();
  };

  // Trigger PDF/Excel direct backend downloads
  const handleBackendExport = async (format: "pdf" | "excel") => {
    if (!printQuoteData) return;
    setErrorMsg("");
    
    // Construct calculation dictionary for the backend. Cost-component
    // sub-rates come from each item's real buildup (from the rate builder /
    // Ruthless Calculator) when present - never a fabricated split, since a
    // fake 50/30/20 material/labour/equipment breakdown would misrepresent
    // the actual cost composition on the exported document.
    const sumBuildupByType = (item: any, type: string): number =>
      (item.buildup || [])
        .filter((b: any) => b.type === type)
        .reduce((acc: number, b: any) => acc + (Number(b.qty) || 0) * (Number(b.rate) || 0), 0);

    const apiPayload = {
      quotation_id: printQuoteData.metadata?.reference_number || "SNC-QT-UNSPECIFIED",
      revision_number: Number(printQuoteData.metadata?.revision_number) || 1,
      currency_rounding_decimals: 2,
      project_title: printQuoteData.metadata?.project_title || "",
      client_name: printQuoteData.client_name || "",
      preliminaries: Number(printQuoteData.metadata?.preliminaries) || 0,
      overhead_rate: (Number(printQuoteData.metadata?.overhead_pct) || 0) / 100,
      contingency_rate: (Number(printQuoteData.metadata?.contingency_pct) || 0) / 100,
      profit_rate: (Number(printQuoteData.metadata?.profit_pct) || 0) / 100,
      discount: Number(printQuoteData.metadata?.discount) || 0,
      tax_rate: printQuoteData.metadata?.apply_vat ? vatRate : 0,
      provisional_sums: Number(printQuoteData.metadata?.provisional_sums) || 0,
      built_area_sqm: Number(printQuoteData.metadata?.built_area_sqm) || 0,
      price_validity_days: Number(printQuoteData.metadata?.valid_until_days) || 30,
      is_inflation_adjusted: Boolean(printQuoteData.metadata?.is_inflation_adjusted),
      assumptions: printQuoteData.metadata?.assumptions || [],
      exclusions: printQuoteData.metadata?.exclusions || [],
      items: printQuoteData.metadata?.items?.map((item: any) => ({
        description: item.description,
        quantity: item.qty,
        rate: item.rate,
        unit: item.unit,
        material_rate: sumBuildupByType(item, "material"),
        labour_rate: sumBuildupByType(item, "labour"),
        equipment_rate: sumBuildupByType(item, "equipment"),
        subcontractor_rate: sumBuildupByType(item, "subcontractor"),
        transport_rate: sumBuildupByType(item, "transport"),
        waste_allowance_rate: sumBuildupByType(item, "waste_allowance"),
      })) || []
    };

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/quotations/exports/${format}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify(apiPayload)
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Quotation_${apiPayload.quotation_id}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setErrorMsg(`Backend export failed: ${err.message}. Defaulting to browser printer.`);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-paper print:bg-white print:text-black print:p-0">
      
      {/* Printable CSS override */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #quotation-print-container, #quotation-print-container * {
            visibility: visible;
          }
          #quotation-print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            border: none !important;
            padding: 0 !important;
            box-shadow: none !important;
            background: white !important;
            color: black !important;
          }
        }
      `}</style>

      {/* Header (hidden on print) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-ink-mid pb-6 print:hidden">
        <div>
          <div className="flex items-center space-x-2">
            <Link 
              href="/dashboard/quotations" 
              className="text-xs font-mono text-slate hover:text-white flex items-center gap-1 uppercase transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white mt-2 flex items-center gap-3">
            <Sliders className="w-6 h-6 text-signal" />
            {editId ? "Edit Estimating Cost Proposal" : "Interactive Cost Proposal Builder"}
          </h1>
          <p className="text-xs text-slate mt-1">
            Formulate complex construction rate-buildups, manage corporate overhead allocations, and monitor margin risks.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setShowImporter(!showImporter)}
            className="flex items-center space-x-1.5 bg-ink border border-ink-mid text-slate hover:text-white px-3 py-1.5 text-xs font-semibold rounded-sm transition-all"
          >
            <Upload className="w-3.5 h-3.5 text-signal" />
            <span>Paste BOQ CSV</span>
          </button>
          <input
            ref={boqFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleBoqFileImport}
          />
          <button
            type="button"
            onClick={() => boqFileInputRef.current?.click()}
            disabled={importingBoqFile}
            className="flex items-center space-x-1.5 bg-ink border border-ink-mid text-slate hover:text-white px-3 py-1.5 text-xs font-semibold rounded-sm transition-all disabled:opacity-50"
          >
            {importingBoqFile ? <Loader2 className="w-3.5 h-3.5 text-signal animate-spin" /> : <Upload className="w-3.5 h-3.5 text-signal" />}
            <span>Upload BOQ File (Excel/CSV)</span>
          </button>
        </div>
      </div>

      {editId && selectedProjectId && (
        <div className="p-4 border border-sky-500/20 bg-sky-950/20 rounded-sm flex items-center space-x-3 text-sky-400 text-sm print:hidden">
          <Info className="w-5 h-5 shrink-0" />
          <span>
            This quotation is linked to a live project. Line-item changes won&apos;t affect the budget until a{" "}
            <Link href="/dashboard/finance/variations" className="underline hover:text-sky-300">Variation</Link> is raised and approved.
          </span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 border border-emerald-500/20 bg-emerald-950/20 rounded-sm flex items-center space-x-3 text-emerald-400 text-sm print:hidden">
          <CheckCircle className="w-5 h-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 border border-red-500/20 bg-red-950/20 rounded-sm flex items-center space-x-3 text-red-400 text-sm print:hidden">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* CSV Paste Importer box */}
      {showImporter && (
        <div className="bg-ink border border-ink-mid p-5 rounded-sm space-y-4 print:hidden">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-signal" /> Paste comma/tab-separated BOQ rows
          </h3>
          <p className="text-xs text-slate">
            Paste rows with structure: <code className="font-mono text-white bg-ink-light px-1">Description, Quantity, Unit, Unit Rate</code>. 
            Example: <br/>
            <code className="block mt-1 p-2 bg-ink-light font-mono text-[10px] text-slate-light rounded-sm">
              Excavation in soft soil, 120, m3, 18.50<br/>
              Reinforced Steel Grade 500, 4.5, t, 1200.00
            </code>
          </p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Paste your spreadsheet rows here..."
            rows={5}
            className="w-full bg-ink-light border border-ink-mid rounded-sm p-3 text-xs text-paper placeholder-slate font-mono focus:outline-none focus:border-signal"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowImporter(false)}
              className="px-3 py-1.5 text-xs text-slate hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={parseBOQText}
              className="bg-signal text-ink px-4 py-1.5 text-xs font-semibold rounded-sm hover:bg-signal-hover transition-colors"
            >
              Parse and Import Items
            </button>
          </div>
        </div>
      )}

      {/* Builder Workspace */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 print:hidden">
          <Loader2 className="w-8 h-8 text-signal animate-spin" />
          <span className="text-xs text-slate font-mono">LOADING PROPOSAL DETAILS...</span>
        </div>
      ) : (
        <form onSubmit={handleSaveQuotation} className="grid grid-cols-1 xl:grid-cols-3 gap-8 print:hidden">
          
          {/* LEFT COL: METADATA & SYSTEM MARKUPS */}
          <div className="space-y-6">
            
            {/* Metadata Card */}
            <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-4">
              <h2 className="font-display font-semibold text-sm text-white border-b border-ink-mid pb-2 flex items-center gap-2">
                <Info className="w-4 h-4 text-signal" /> Client &amp; Project Info
              </h2>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Client Organization *</span>
                <input 
                  required
                  type="text" 
                  placeholder="e.g. Apex Mining Ltd" 
                  value={clientName} 
                  onChange={(e) => setClientName(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Client Email</span>
                <input 
                  type="email" 
                  placeholder="contact@client.com" 
                  value={clientEmail} 
                  onChange={(e) => setClientEmail(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Project/Proposal Title *</span>
                <input 
                  required
                  type="text" 
                  placeholder="e.g. Concrete foundations pour phase 2" 
                  value={projectTitle} 
                  onChange={(e) => setProjectTitle(e.target.value)} 
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                />
              </label>

              {/* Scope to active projects selector */}
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate flex items-center gap-1">
                  Scope to Active Project
                  <span title="Linking automatically integrates estimating metrics inside the project details.">
                    <HelpCircle className="w-3 h-3 text-slate-light" />
                  </span>
                </span>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-slate-light focus:text-white outline-none focus:border-signal cursor-pointer"
                >
                  <option value="">-- Optional: Link to database project --</option>
                  {projectsList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <label className="block">
                  <span className="font-mono text-[9px] uppercase text-slate">Reference No</span>
                  <input 
                    type="text" 
                    value={quoteRef} 
                    onChange={(e) => setQuoteRef(e.target.value)} 
                    className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[9px] uppercase text-slate">Proposal Date</span>
                  <input 
                    type="date" 
                    value={quoteDate} 
                    onChange={(e) => setQuoteDate(e.target.value)} 
                    className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-mono text-[9px] uppercase text-slate">Currency</span>
                  <select 
                    value={currency} 
                    onChange={(e) => setCurrency(e.target.value)} 
                    className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal cursor-pointer"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="ZWG">ZWG (ZiG)</option>
                  </select>
                </label>

                <label className="block">
                  <span className="font-mono text-[9px] uppercase text-slate">Validity (Days)</span>
                  <input
                    type="number"
                    value={validDays}
                    onChange={(e) => setValidDays(Number(e.target.value))}
                    className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                  />
                </label>
              </div>

              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate flex items-center gap-1">
                  Built Area (sqm)
                  <span title="Drives the $/m2 benchmark check on the calculation and the CCB's cost-per-sqm scoring. Leave at 0 if not applicable (e.g. a purely civil/infrastructure scope).">
                    <HelpCircle className="w-3 h-3 text-slate-light" />
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={builtAreaSqm}
                  onChange={(e) => setBuiltAreaSqm(Number(e.target.value) || 0)}
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                />
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInflationAdjusted}
                  onChange={(e) => setIsInflationAdjusted(e.target.checked)}
                  className="accent-signal w-3.5 h-3.5"
                />
                <span className="font-mono text-[9px] uppercase text-slate flex items-center gap-1">
                  Rates are inflation-adjusted for current material pricing
                  <span title="Confirms these rates have been checked against current material/labour costs, not stale historical figures. Leave unchecked to flag the document for a pricing review.">
                    <HelpCircle className="w-3 h-3 text-slate-light" />
                  </span>
                </span>
              </label>
            </div>

            {/* Calculations Markups */}
            <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-4">
              <h2 className="font-display font-semibold text-sm text-white border-b border-ink-mid pb-2 flex items-center gap-2">
                <Coins className="w-4 h-4 text-signal" /> Markups &amp; Allowances
              </h2>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-[10px] font-mono text-slate mb-1 uppercase">
                    <span>Preliminaries Cost ($)</span>
                    <span className="text-white">${preliminaries.toLocaleString()}</span>
                  </div>
                  <input 
                    type="range" 
                    min={0} 
                    max={50000} 
                    step={500}
                    value={preliminaries} 
                    onChange={(e) => setPreliminaries(Number(e.target.value))} 
                    className="w-full accent-signal h-1 bg-ink"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] font-mono text-slate mb-1 uppercase">
                    <span>Overhead Allocation %</span>
                    <span className="text-white">{overheadPct}%</span>
                  </div>
                  <input 
                    type="range" 
                    min={0} 
                    max={30} 
                    value={overheadPct} 
                    onChange={(e) => setOverheadPct(Number(e.target.value))} 
                    className="w-full accent-signal h-1 bg-ink"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] font-mono text-slate mb-1 uppercase">
                    <span>Contingency Allowance %</span>
                    <span className="text-white">{contingencyPct}%</span>
                  </div>
                  <input 
                    type="range" 
                    min={0} 
                    max={20} 
                    value={contingencyPct} 
                    onChange={(e) => setContingencyPct(Number(e.target.value))} 
                    className="w-full accent-signal h-1 bg-ink"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[10px] font-mono text-slate mb-1 uppercase">
                    <span>Target Profit %</span>
                    <span className="text-white">{profitPct}%</span>
                  </div>
                  <input 
                    type="range" 
                    min={0} 
                    max={40} 
                    value={profitPct} 
                    onChange={(e) => setProfitPct(Number(e.target.value))} 
                    className="w-full accent-signal h-1 bg-ink"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-ink-mid/30 pt-3">
                  <label className="block">
                    <span className="font-mono text-[9px] uppercase text-slate">Provisional Sums ($)</span>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={provisionalSums}
                      onChange={(e) => setProvisionalSums(Number(e.target.value) || 0)}
                      className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[9px] uppercase text-slate">Discount ($)</span>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={discount}
                      onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                      className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper font-mono outline-none focus:border-signal"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between border-t border-ink-mid/30 pt-3">
                  <span className="text-xs text-slate-light font-mono uppercase">
                    Apply {(vatRate * 100).toFixed(vatRate * 100 % 1 === 0 ? 0 : 2)}% VAT
                  </span>
                  <input
                    type="checkbox"
                    checked={applyVat}
                    onChange={(e) => setApplyVat(e.target.checked)}
                    className="w-4 h-4 accent-signal bg-ink border border-ink-mid cursor-pointer"
                  />
                </div>
                {!vatRateIsConfigured && (
                  <p className="text-[10px] text-amber-400/80 font-mono">
                    No VAT rate table configured for {currency} in Finance &gt; Statutory &gt; Rate Tables - using the default 15% until one is entered.
                  </p>
                )}
              </div>
            </div>

            {/* Assumptions & Exclusions */}
            <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-4">
              <h2 className="font-display font-semibold text-sm text-white border-b border-ink-mid pb-2 flex items-center gap-2">
                <Info className="w-4 h-4 text-signal" /> Assumptions &amp; Exclusions
              </h2>
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Assumptions (one per line)</span>
                <textarea
                  value={assumptionsText}
                  onChange={(e) => setAssumptionsText(e.target.value)}
                  rows={3}
                  placeholder={"Rates assume normal working hours and unobstructed site access.\nClient will provide approved drawings before mobilisation."}
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal resize-y"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[9px] uppercase text-slate">Exclusions (one per line)</span>
                <textarea
                  value={exclusionsText}
                  onChange={(e) => setExclusionsText(e.target.value)}
                  rows={3}
                  placeholder={"Rock blasting and contaminated soil remediation.\nClient-side professional fees and third-party inspections."}
                  className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal resize-y"
                />
              </label>
            </div>

          </div>

          {/* RIGHT COL: BOQ LINES TABLE & LIVE TOTALS */}
          <div className="xl:col-span-2 space-y-6">
            
            {/* BOQ Items table card */}
            <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-4">
              <div className="flex justify-between items-center border-b border-ink-mid pb-2">
                <h2 className="font-display font-semibold text-sm text-white">Bill of Quantities (BOQ)</h2>
                <button
                  type="button"
                  onClick={addLineItem}
                  className="flex items-center space-x-1 bg-signal text-ink px-2.5 py-1 text-xs font-semibold rounded-sm hover:bg-signal-hover transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Line</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-ink-mid/60 text-slate font-mono uppercase tracking-wider text-[10px]">
                      <th className="pb-2 font-normal w-12 text-center">#</th>
                      <th className="pb-2 font-normal">Description</th>
                      <th className="pb-2 font-normal w-20 text-center">Qty</th>
                      <th className="pb-2 font-normal w-20 text-center">Unit</th>
                      <th className="pb-2 font-normal w-28 text-right">Unit Rate</th>
                      <th className="pb-2 font-normal w-28 text-right">Subtotal</th>
                      <th className="pb-2 font-normal w-12 text-right">Rate Builder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-ink-mid/30 hover:bg-white/[0.01]">
                        <td className="py-2 text-center font-mono text-slate">
                          <button
                            type="button"
                            onClick={() => removeLineItem(idx)}
                            className="p-1 text-slate hover:text-red-400 rounded-sm hover:bg-red-500/10"
                            disabled={lineItems.length === 1}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                        <td className="py-2">
                          <input 
                            required
                            type="text" 
                            placeholder="e.g. Concrete foundations pouring"
                            value={item.description}
                            onChange={(e) => handleLineItemChange(idx, "description", e.target.value)}
                            className="w-full bg-transparent border-0 border-b border-transparent hover:border-ink-mid focus:border-signal outline-none text-white text-xs py-1"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input 
                            required
                            type="number" 
                            step="any"
                            value={item.qty}
                            onChange={(e) => handleLineItemChange(idx, "qty", parseFloat(e.target.value) || 0)}
                            className="w-full bg-transparent border-0 border-b border-transparent hover:border-ink-mid focus:border-signal outline-none text-center font-mono text-white text-xs py-1"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input 
                            type="text" 
                            value={item.unit}
                            onChange={(e) => handleLineItemChange(idx, "unit", e.target.value)}
                            className="w-full bg-transparent border-0 border-b border-transparent hover:border-ink-mid focus:border-signal outline-none text-center font-mono text-white text-xs py-1"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input 
                            required
                            type="number" 
                            step="any"
                            value={item.rate}
                            onChange={(e) => handleLineItemChange(idx, "rate", parseFloat(e.target.value) || 0)}
                            className="w-full bg-transparent border-0 border-b border-transparent hover:border-ink-mid focus:border-signal outline-none text-right font-mono text-white text-xs py-1"
                          />
                        </td>
                        <td className="py-2 text-right font-mono text-white text-xs font-semibold">
                          ${(item.qty * item.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openRateBuilder(idx)}
                            className="p-1 border border-ink-mid bg-ink rounded-sm hover:border-signal/50 text-slate hover:text-white text-[10px] font-mono"
                            title="Open detailed rate calculator"
                          >
                            Buildup
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Calculations buildup display card */}
            <div className="bg-ink-light border border-ink-mid p-6 rounded-sm space-y-4">
              <h2 className="font-display font-semibold text-sm text-white border-b border-ink-mid pb-2">
                Cost Buildup Calculation Summary
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs font-mono">
                <div className="space-y-2 text-slate-light border-r border-ink-mid/30 pr-4">
                  <div className="flex justify-between">
                    <span>Direct Construction Cost (BOQ):</span>
                    <span className="text-white">${directCosts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Preliminaries &amp; General:</span>
                    <span className="text-white">${preliminaries.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between border-t border-ink-mid/30 pt-1">
                    <span>Subtotal Base (Direct + Prelims):</span>
                    <span className="text-white">${totalDirectAndPrelims.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Overhead Allocation ({overheadPct}%):</span>
                    <span className="text-white">${overheadAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Contingency ({contingencyPct}%):</span>
                    <span className="text-white">${contingencyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="space-y-2 text-slate-light flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Running Subtotal (Direct+Prelims+OH+Contingency):</span>
                      <span className="text-white">${subtotalBeforeProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span title="Profit is a % of Direct Costs + Preliminaries only - it is not compounded on Overhead or Contingency.">
                        Profit Margin Mark-up ({profitPct}% of Direct+Prelims: ${totalDirectAndPrelims.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}):
                      </span>
                      <span className="text-white">${profitAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    {provisionalSums > 0 && (
                      <div className="flex justify-between">
                        <span>Provisional Sums:</span>
                        <span className="text-white">${provisionalSums.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-ink-mid/30 pt-1 font-semibold text-white">
                      <span>Subtotal (VAT Exclusive):</span>
                      <span>${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    {discount > 0 && (
                      <>
                        <div className="flex justify-between text-slate-light">
                          <span>Discount:</span>
                          <span className="text-red-400">-${discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-slate-light">
                          <span>Taxable Amount:</span>
                          <span className="text-white">${taxableAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-slate-light">
                      <span>VAT (15%):</span>
                      <span className="text-white">${vat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  <div className="border-t border-signal/30 pt-3 flex justify-between items-center text-white bg-signal/5 p-3 border border-signal/15">
                    <span className="font-display font-bold uppercase tracking-wider text-xs">Grand Total Proposal:</span>
                    <span className="font-mono font-bold text-lg text-signal">${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  {warnings.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {warnings.map((w, idx) => (
                        <div key={idx} className="flex items-start gap-2 p-2 border border-amber-500/20 bg-amber-950/20 rounded-sm text-[10px] text-amber-400 leading-snug">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-ink-mid/30 pt-4 flex justify-between gap-4">
                <label className="block w-full">
                  <span className="font-mono text-[9px] uppercase text-slate">Proposal Terms &amp; Scope Details</span>
                  <input 
                    type="text" 
                    value={terms} 
                    onChange={(e) => setTerms(e.target.value)} 
                    className="mt-1 w-full border border-ink-mid bg-ink px-3 py-2 text-xs text-paper outline-none focus:border-signal"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center space-x-2 bg-signal text-ink px-6 py-2.5 text-sm font-bold uppercase tracking-wide rounded-sm hover:bg-signal-hover hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Save Cost Estimate</span>
                  </button>
                </div>
              </div>
            </div>

          </div>

        </form>
      )}

      {/* COST RATE BUILDER MODAL */}
      {selectedRowIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 print:hidden">
          <div className={`bg-ink border border-ink-mid rounded-sm p-6 ${showRuthlessCalc ? "max-w-6xl" : "max-w-3xl"} w-full space-y-4 transition-all duration-300`}>
            
            <div className="flex justify-between items-start border-b border-ink-mid pb-3">
              <div>
                <h3 className="font-display font-semibold text-lg text-white">
                  Detailed Rate Cost Buildup: Item #{selectedRowIndex + 1}
                </h3>
                <p className="text-xs text-slate mt-1">
                  Line description: &quot;{lineItems[selectedRowIndex]?.description || "Untitled Item"}&quot;
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRuthlessCalc(!showRuthlessCalc)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-all border ${
                  showRuthlessCalc 
                    ? "bg-signal text-ink border-signal" 
                    : "bg-ink-light text-signal border-ink-mid hover:text-white"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{showRuthlessCalc ? "Close Ruthless Estimator" : "Open Ruthless Estimator"}</span>
              </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 items-stretch">
              <div className="flex-1 space-y-4 flex flex-col justify-between">
                
                <div className="overflow-y-auto max-h-[350px] border border-ink-mid rounded-sm p-3 bg-ink-light space-y-2">
                  {tempBuildup.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate">
                      No rate components recorded. Add material, labour, or equipment components.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-12 gap-3 text-[10px] font-mono text-slate uppercase border-b border-ink-mid/30 pb-1">
                        <span className="col-span-3">Component Type</span>
                        <span className="col-span-4">Name/Description</span>
                        <span className="col-span-2 text-center">Qty</span>
                        <span className="col-span-2 text-right">Unit Cost</span>
                        <span className="col-span-1 text-right">Actions</span>
                      </div>
                      {tempBuildup.map((row, rIdx) => (
                        <div key={rIdx} className="grid grid-cols-12 gap-3 items-center text-xs">
                          <select
                            value={row.type}
                            onChange={(e) => {
                              const copy = [...tempBuildup];
                              copy[rIdx].type = e.target.value;
                              setTempBuildup(copy);
                            }}
                            className="col-span-3 bg-ink border border-ink-mid text-white text-xs p-1 focus:border-signal"
                          >
                            <option value="material">Material</option>
                            <option value="labour">Labour</option>
                            <option value="equipment">Equipment</option>
                            <option value="subcontractor">Subcontractor</option>
                            <option value="transport">Transport</option>
                            <option value="waste_allowance">Waste Allowance</option>
                          </select>
                          <input 
                            type="text" 
                            placeholder="e.g. Portland Cement CEM II"
                            value={row.name}
                            onChange={(e) => {
                              const copy = [...tempBuildup];
                              copy[rIdx].name = e.target.value;
                              setTempBuildup(copy);
                            }}
                            className="col-span-4 bg-ink border border-ink-mid text-white text-xs p-1 focus:border-signal"
                          />
                          <input 
                            type="number" 
                            step="any"
                            value={row.qty}
                            onChange={(e) => {
                              const copy = [...tempBuildup];
                              copy[rIdx].qty = parseFloat(e.target.value) || 0;
                              setTempBuildup(copy);
                            }}
                            className="col-span-2 bg-ink border border-ink-mid text-center text-white text-xs p-1 focus:border-signal font-mono"
                          />
                          <input 
                            type="number" 
                            step="any"
                            value={row.rate}
                            onChange={(e) => {
                              const copy = [...tempBuildup];
                              copy[rIdx].rate = parseFloat(e.target.value) || 0;
                              setTempBuildup(copy);
                            }}
                            className="col-span-2 bg-ink border border-ink-mid text-right text-white text-xs p-1 focus:border-signal font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => removeBuildupRow(rIdx)}
                            className="col-span-1 p-1 text-slate hover:text-red-400 mx-auto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center py-2">
                  <button
                    type="button"
                    onClick={addBuildupRow}
                    className="flex items-center space-x-1 bg-ink border border-ink-mid text-slate hover:text-white px-2.5 py-1 text-xs rounded-sm transition-all"
                  >
                    <Plus className="w-3 h-3 text-signal" />
                    <span>Add Cost Row</span>
                  </button>

                  <div className="font-mono text-xs text-white">
                    Computed Unit Rate: <span className="font-bold text-signal">${tempBuildup.reduce((a, c) => a + c.qty * c.rate, 0).toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-ink-mid/30 pt-4 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRowIndex(null);
                      setShowRuthlessCalc(false);
                    }}
                    className="px-3 py-1.5 text-xs text-slate hover:text-white border border-ink-mid/40 hover:bg-ink-light rounded-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveRateBuildup}
                    className="bg-signal text-ink px-4 py-1.5 text-xs font-semibold rounded-sm hover:bg-signal-hover transition-colors"
                  >
                    Apply to BOQ Rate
                  </button>
                </div>

              </div>

              {showRuthlessCalc && (
                <div className="w-full lg:w-96 xl:w-112 shrink-0 border-t lg:border-t-0 lg:border-l border-ink-mid/60 pt-6 lg:pt-0 lg:pl-6 max-h-[500px] overflow-y-auto">
                  <RuthlessCalculator
                    lineItemQty={lineItems[selectedRowIndex]?.qty || 0}
                    lineItemUnit={lineItems[selectedRowIndex]?.unit || ""}
                    onInject={(generatedRows) => {
                      setTempBuildup(generatedRows);
                    }}
                    onClose={() => setShowRuthlessCalc(false)}
                  />
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* DOCUMENT PREVIEW & PDF/EXCEL EXPORTER OVERLAY */}
      {printQuoteData && (
        <div className="space-y-6">
          
          {/* Action header for preview (hidden on print) */}
          <div className="bg-ink border border-ink-mid p-5 rounded-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
            <div className="space-y-1">
              <h2 className="text-sm font-bold font-mono uppercase text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-signal" /> Branded Proposal &amp; Document Generator
              </h2>
              <p className="text-xs text-slate">Preview client layout below. Select export format options:</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-ink-light border border-ink-mid p-1 rounded-sm">
                {(["quotation", "boq", "schedule"] as const).map(t => (
                  <button 
                    key={t}
                    onClick={() => setPrintType(t)}
                    className={`px-3 py-1 font-mono text-[9px] uppercase rounded-sm transition-all ${
                      printType === t ? "bg-signal text-ink font-bold" : "text-slate hover:text-white"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button 
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 border border-signal bg-signal/15 px-3 py-1.5 font-mono text-[10px] uppercase text-signal hover:bg-signal/25 transition-all"
                >
                  <Printer className="w-3.5 h-3.5" /> Browser Print (PDF)
                </button>
                <button 
                  onClick={() => handleBackendExport("pdf")}
                  className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-[10px] uppercase text-slate hover:text-white transition-all"
                  title="Generate high quality A4 PDF on backend"
                >
                  <Download className="w-3.5 h-3.5 text-signal" /> Build ReportLab PDF
                </button>
                <button 
                  onClick={() => handleBackendExport("excel")}
                  className="inline-flex items-center gap-1.5 border border-ink-mid bg-ink px-3 py-1.5 font-mono text-[10px] uppercase text-slate hover:text-white transition-all"
                  title="Export detailed workbook excel sheet"
                >
                  <Download className="w-3.5 h-3.5 text-signal" /> Export Excel
                </button>
                <button 
                  onClick={() => setPrintQuoteData(null)}
                  className="border border-ink-mid px-3 py-1.5 font-mono text-[10px] uppercase text-slate hover:text-white hover:bg-ink-light"
                >
                  Close
                </button>
              </div>
            </div>
          </div>

          {/* PRINT PREVIEW CONTAINER (Always renders, prints directly via browser CSS) */}
          <div 
            id="quotation-print-container" 
            className="bg-ink-light border border-ink-mid p-8 max-w-[800px] mx-auto text-paper flex flex-col justify-between min-h-[900px] rounded-sm print:border-0 print:p-0 print:bg-white print:text-black print:w-full print:min-h-0"
          >
            
            {/* Header Block */}
            <div className="flex justify-between items-start border-b border-ink-mid pb-6 print:border-slate-300">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-signal rounded-sm flex items-center justify-center print:bg-black">
                    <span className="font-display text-ink font-bold text-base print:text-white font-bold">SNC</span>
                  </div>
                  <span className="font-display text-xl tracking-wider text-white print:text-black font-bold">SIX NINE CONSTRUCTION</span>
                </div>
                <p className="text-[10px] text-slate mt-2 print:text-slate-500 leading-relaxed font-mono">
                  102 Samora Machel Avenue, Harare, Zimbabwe<br />
                  Phone: +263 242 770110 | Email: bids@sixnineconstruction.com
                </p>
              </div>
              <div className="text-right">
                <h1 className="font-display text-2xl text-signal font-bold uppercase tracking-wider print:text-black">
                  {printType === "quotation" ? "QUOTATION" : printType === "boq" ? "BILL OF QUANTITIES" : "DELIVERY SCHEDULE"}
                </h1>
                <table className="mt-3 inline-block text-left font-mono text-[9px] print:text-slate-700">
                  <tbody>
                    <tr>
                      <td className="pr-3 text-slate font-bold">DOC REF:</td>
                      <td className="text-white print:text-black font-bold">{printQuoteData.metadata?.reference_number || "SNC-QT-UNSPECIFIED"}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 text-slate">DATE:</td>
                      <td className="text-slate-light print:text-black">{printQuoteData.metadata?.quote_date || quoteDate}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 text-slate">VALID UNTIL:</td>
                      <td className="text-slate-light print:text-black">{printQuoteData.metadata?.valid_until}</td>
                    </tr>
                    <tr>
                      <td className="pr-3 text-slate">CURRENCY:</td>
                      <td className="text-slate-light print:text-black">{printQuoteData.metadata?.currency}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Client address details */}
            <div className="grid grid-cols-2 gap-8 my-6 text-[11px]">
              <div>
                <span className="font-mono text-[9px] text-slate uppercase block">PREPARED FOR:</span>
                <p className="font-bold text-white print:text-black text-sm mt-1">{printQuoteData.client_name}</p>
                <p className="text-slate-light print:text-slate-600 mt-0.5">{printQuoteData.metadata?.client_email || "contact@client.com"}</p>
              </div>
              <div>
                <span className="font-mono text-[9px] text-slate uppercase block">PROJECT NAME:</span>
                <p className="font-bold text-white print:text-black text-sm mt-1">{printQuoteData.metadata?.project_title}</p>
                <p className="text-slate-light print:text-slate-600 mt-0.5">Civil &amp; Infrastructure Engineering Services</p>
              </div>
            </div>

            {/* Print preview content items details */}
            <div className="flex-1 my-4">
              
              {/* QUOTATION STANDARD VIEW */}
              {printType === "quotation" && (
                <div className="space-y-4">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-ink-mid text-slate font-mono uppercase tracking-wider text-[9px] print:border-slate-300 print:text-slate-700">
                        <th className="pb-2 font-normal w-12 text-center">ITEM</th>
                        <th className="pb-2 font-normal">DESCRIPTION</th>
                        <th className="pb-2 font-normal w-20 text-center">QTY</th>
                        <th className="pb-2 font-normal w-20 text-center">UNIT</th>
                        <th className="pb-2 font-normal w-28 text-right">TOTAL PRICE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printQuoteData.metadata?.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b border-ink-mid/30 hover:bg-white/[0.01] print:border-slate-100">
                          <td className="py-2.5 text-center font-mono text-slate print:text-black">{idx + 1}</td>
                          <td className="py-2.5 text-slate-light print:text-black font-semibold">{item.description}</td>
                          <td className="py-2.5 text-center font-mono text-slate print:text-black">{item.qty}</td>
                          <td className="py-2.5 text-center font-mono text-slate print:text-black uppercase">{item.unit}</td>
                          <td className="py-2.5 text-right font-mono text-white print:text-black font-bold">
                            ${(item.qty * item.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Calculations buildup rows */}
                  <div className="flex justify-end pt-4">
                    <table className="w-72 font-mono text-[10px] text-slate-light print:text-slate-700">
                      <tbody>
                        <tr className="border-b border-ink-mid/30">
                          <td className="py-2 text-slate">Direct Construction (BOQ)</td>
                          <td className="py-2 text-right text-white print:text-black">${printQuoteData.metadata?.direct_costs?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="border-b border-ink-mid/30">
                          <td className="py-2 text-slate">Preliminaries &amp; General</td>
                          <td className="py-2 text-right text-white print:text-black">${printQuoteData.metadata?.preliminaries?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="border-b border-ink-mid/30">
                          <td className="py-2 text-slate">Overheads ({printQuoteData.metadata?.overhead_pct}%)</td>
                          <td className="py-2 text-right text-white print:text-black">${(printQuoteData.metadata?.overhead_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="border-b border-ink-mid/30">
                          <td className="py-2 text-slate">Contingency ({printQuoteData.metadata?.contingency_pct}%)</td>
                          <td className="py-2 text-right text-white print:text-black">${(printQuoteData.metadata?.contingency_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="border-b border-ink-mid/30">
                          <td className="py-2 text-slate">Markup Profit ({printQuoteData.metadata?.profit_pct}%)</td>
                          <td className="py-2 text-right text-white print:text-black">${(printQuoteData.metadata?.profit_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        {(printQuoteData.metadata?.provisional_sums || 0) > 0 && (
                          <tr className="border-b border-ink-mid/30">
                            <td className="py-2 text-slate">Provisional Sums</td>
                            <td className="py-2 text-right text-white print:text-black">${printQuoteData.metadata.provisional_sums.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        )}
                        <tr className="border-b border-ink-mid/30 font-semibold text-white print:text-black">
                          <td className="py-2">Subtotal (VAT Excl.)</td>
                          <td className="py-2 text-right">${printQuoteData.metadata?.subtotal?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        {(printQuoteData.metadata?.discount || 0) > 0 && (
                          <>
                            <tr className="border-b border-ink-mid/30">
                              <td className="py-2 text-slate">Discount</td>
                              <td className="py-2 text-right text-red-400">-${printQuoteData.metadata.discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                            <tr className="border-b border-ink-mid/30">
                              <td className="py-2 text-slate">Taxable Amount</td>
                              <td className="py-2 text-right text-white print:text-black">${printQuoteData.metadata?.taxable_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                          </>
                        )}
                        <tr className="border-b border-ink-mid/30">
                          <td className="py-2 text-slate">VAT (15%)</td>
                          <td className="py-2 text-right text-white print:text-black">${printQuoteData.metadata?.vat?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        <tr className="text-white print:text-black font-bold text-xs bg-white/5 print:bg-slate-100 border-t border-signal print:border-black">
                          <td className="py-2.5 pl-2">GRAND TOTAL</td>
                          <td className="py-2.5 pr-2 text-right text-signal print:text-black">${printQuoteData.quote_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* DETAILED BOQ BREAKDOWN VIEW */}
              {printType === "boq" && (
                <div className="space-y-4">
                  <span className="font-mono text-[9px] text-slate uppercase block print:text-slate-700">Detailed Bill of Quantities (BOQ) with Unit Rates</span>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-ink-mid text-slate font-mono uppercase tracking-wider text-[9px] print:border-slate-300 print:text-slate-700">
                        <th className="pb-2 font-normal w-12 text-center">ITEM</th>
                        <th className="pb-2 font-normal">DESCRIPTION</th>
                        <th className="pb-2 font-normal w-20 text-center">QTY</th>
                        <th className="pb-2 font-normal w-20 text-center">UNIT</th>
                        <th className="pb-2 font-normal w-24 text-right">UNIT RATE</th>
                        <th className="pb-2 font-normal w-28 text-right">TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printQuoteData.metadata?.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b border-ink-mid/30 hover:bg-white/[0.01] print:border-slate-100">
                          <td className="py-2.5 text-center font-mono text-slate print:text-black">{idx + 1}</td>
                          <td className="py-2.5 text-slate-light print:text-black font-semibold">
                            {item.description}
                          </td>
                          <td className="py-2.5 text-center font-mono text-slate print:text-black">{item.qty}</td>
                          <td className="py-2.5 text-center font-mono text-slate print:text-black uppercase">{item.unit}</td>
                          <td className="py-2.5 text-right font-mono text-slate-light print:text-black">${item.rate.toFixed(2)}</td>
                          <td className="py-2.5 text-right font-mono text-white print:text-black font-bold">
                            ${(item.qty * item.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* DELIVERY SEQUENCE VIEW - line order only, NOT a real schedule.
                  We have no per-item duration/productivity data at this point
                  in the Builder, so this must not present fabricated week
                  numbers as a committed programme (that was found and flagged
                  as a serious issue elsewhere in this module's PDF output). */}
              {printType === "schedule" && (
                <div className="space-y-4">
                  <span className="font-mono text-[9px] text-slate uppercase block print:text-slate-700">Indicative Delivery Sequence (BOQ Line Order - Not a Committed Programme)</span>
                  <p className="text-[9px] text-slate print:text-slate-600 italic">Sequence numbers reflect BOQ line order only. A committed weekly programme requires a separate schedule derived from real productivity rates and dependencies.</p>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-ink-mid text-slate font-mono uppercase tracking-wider text-[9px] print:border-slate-300 print:text-slate-700">
                        <th className="pb-2 font-normal w-24 text-center">SEQUENCE</th>
                        <th className="pb-2 font-normal">DELIVERY DESCRIPTION</th>
                        <th className="pb-2 font-normal w-28 text-center">UNIT SCOPE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printQuoteData.metadata?.items?.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b border-ink-mid/30 hover:bg-white/[0.01] print:border-slate-100">
                          <td className="py-2.5 text-center font-mono text-slate print:text-black">M-{idx + 1}</td>
                          <td className="py-2.5 text-slate-light print:text-black">{item.description}</td>
                          <td className="py-2.5 text-center font-mono text-slate-light print:text-black">{item.qty} {item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>

            {/* Assumptions & Exclusions */}
            {((printQuoteData.metadata?.assumptions || []).length > 0 || (printQuoteData.metadata?.exclusions || []).length > 0) && (
              <div className="border-t border-ink-mid pt-4 mt-6 print:border-slate-300 text-[10px] leading-relaxed text-slate-light print:text-slate-700 font-mono grid grid-cols-2 gap-6">
                {(printQuoteData.metadata?.assumptions || []).length > 0 && (
                  <div>
                    <span className="font-mono text-[9px] text-slate uppercase block mb-1">Assumptions</span>
                    <ul className="list-disc list-inside space-y-0.5">
                      {printQuoteData.metadata.assumptions.map((a: string, i: number) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(printQuoteData.metadata?.exclusions || []).length > 0 && (
                  <div>
                    <span className="font-mono text-[9px] text-slate uppercase block mb-1">Exclusions</span>
                    <ul className="list-disc list-inside space-y-0.5">
                      {printQuoteData.metadata.exclusions.map((x: string, i: number) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Terms and Scope Details Footer */}
            <div className="border-t border-ink-mid pt-6 mt-8 print:border-slate-300 text-[10px] leading-relaxed text-slate-light print:text-slate-700 font-mono">
              <span className="font-mono text-[9px] text-slate uppercase block">TERMS AND CONDITIONS:</span>
              <p className="mt-1">{printQuoteData.metadata?.terms || terms}</p>
              <div className="grid grid-cols-2 gap-4 mt-6">
                <div>
                  <p className="border-b border-ink-mid/50 w-48 pb-1 print:border-slate-300"></p>
                  <p className="text-[9px] mt-1 text-slate uppercase">Authorised Signature (SNC)</p>
                </div>
                <div className="text-right flex flex-col items-end">
                  <p className="border-b border-ink-mid/50 w-48 pb-1 print:border-slate-300"></p>
                  <p className="text-[9px] mt-1 text-slate uppercase">Client Acceptance &amp; Date</p>
                </div>
              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
