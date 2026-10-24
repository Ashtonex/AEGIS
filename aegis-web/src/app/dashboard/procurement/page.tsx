"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Loader2, Plus, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { SupplyControlTower } from "@/components/supply/SupplyControlTower";
import { ThreeWayMatchInspectorModal } from "@/components/supply/ThreeWayMatchInspectorModal";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { approvePurchaseOrder, approveProcurementRequisition, createProcurementRfq, createPurchaseOrderFromRequisition, createPurchaseOrderFromRfq, decideProcurementRfqResponse, decideSupplierInvoicePayment, confirmMaterialRequestPrice, getCcbFindings, getInternalProjects, getInventoryStores, getInventoryStockLevels, getMaterialRequests, getProcurementInvoices, getProcurementOrders, getProcurementRequisitions, getProcurementRfqs, getProcurementSuppliers, getStockMovements, issuePurchaseOrder, linkProcurementDocument, matchSupplierInvoice, recordProcurementRfqResponse, recordGoodsReceived, registerSupplierInvoice, submitProcurementRequisition } from "@/lib/api";
import { InvoicesTab, PaymentEvidenceModal } from "@/components/procurement/invoices";
import { OrdersTable, PODetailDrawer, ReceiveGoodsModal, SupplierInvoiceModal } from "@/components/procurement/orders";
import { ProcurementCommandDashboard } from "@/components/procurement/overview";
import { ApproveModal, CreatePOModal, CreatePRModal, CreateRfqModal, PendingPricingTable, RequisitionsTable, RfqResponseModal, RfqsTab } from "@/components/procurement/requests";
import { Banner, LoadingState, type PaymentEvidencePayload, type Rec, StatusChips, type Tab, dt, isPoOverdue, itemType, loadFailureMessage, money, movementDate, normalizeActionError, num, stockValue, tx } from "@/components/procurement/shared";
import { AddSupplierModal, CredentialsIssuedModal, Supplier360Modal, SuppliersTable } from "@/components/procurement/suppliers";


const PROCUREMENT_TAB_META: Record<Tab, { title: string; subtitle: string }> = {
  command: { title: "Procurement Overview", subtitle: "What is in store, what moved, what is on the way, and what needs a decision." },
  requisitions: { title: "Purchase Requests", subtitle: "Requests for materials from site and office: submit, approve, then raise a PO (quotes optional)." },
  pricing: { title: "Pending Pricing", subtitle: "Site material requests issued without a known price. Confirm the real unit cost here." },
  rfqs: { title: "Quotes", subtitle: "Optional: ask suppliers to quote, compare the answers, pick one, then raise the PO." },
  orders: { title: "Purchase Orders", subtitle: "Approved orders: issue them, track delivery, receive goods and register invoices." },
  invoices: { title: "Supplier Invoices", subtitle: "Check each invoice against its order and what was delivered, then approve payment." },
  suppliers: { title: "Suppliers", subtitle: "Supplier register with compliance, delivery performance and open balances." },
};


// ─── Page export ──────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams?.get("tab");
  const initialTab: Tab =
    requestedTab === "command" || requestedTab === "requisitions" || requestedTab === "rfqs" || requestedTab === "orders" || requestedTab === "suppliers" || requestedTab === "invoices" || requestedTab === "pricing"
      ? (requestedTab === "orders" ? "orders" : requestedTab)
      : "command";

  return (
    <RBACGuard>
      <ProcurementWorkspace initialTab={initialTab} />
    </RBACGuard>
  );
}


// ─── Workspace ────────────────────────────────────────────────────────────────

const TAB_ROUTES: Record<Tab, string> = {
  command: "/dashboard/procurement",
  requisitions: "/dashboard/procurement/requisitions",
  rfqs: "/dashboard/procurement/rfqs",
  orders: "/dashboard/procurement/purchase-orders",
  suppliers: "/dashboard/procurement/suppliers",
  invoices: "/dashboard/procurement/invoices",
  pricing: "/dashboard/procurement/pricing",
};


function ProcurementWorkspace({ initialTab = "requisitions" }: { initialTab?: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [prStatus, setPrStatus] = useState("all");
  const [rfqStatus, setRfqStatus] = useState("all");
  const [poStatus, setPoStatus] = useState("all");
  const [invMatchStatus, setInvMatchStatus] = useState("all");
  const [supplierCompliance, setSupplierCompliance] = useState("all");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreatePR, setShowCreatePR] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [viewingSupplier, setViewingSupplier] = useState<Rec | null>(null);
  const [issuedSupplierCredentials, setIssuedSupplierCredentials] = useState<{ email: string; temporary_password: string } | null>(null);
  const [selectedPO, setSelectedPO] = useState<Rec | null>(null);
  const [approvingPR, setApprovingPR] = useState<Rec | null>(null);
  const [overridePromptFor, setOverridePromptFor] = useState<{ id: string; action: "submit" | "approve"; message: string; decisionReason?: string } | null>(null);
  const [creatingRfqFromPR, setCreatingRfqFromPR] = useState<Rec | null>(null);
  const [creatingPOFromPR, setCreatingPOFromPR] = useState<Rec | null>(null);
  const [quotingRfq, setQuotingRfq] = useState<Rec | null>(null);
  const [receivingPO, setReceivingPO] = useState<Rec | null>(null);
  const [invoicingPO, setInvoicingPO] = useState<Rec | null>(null);
  const [paymentEvidenceInvoice, setPaymentEvidenceInvoice] = useState<Rec | null>(null);
  const [inspectingMatchInvoice, setInspectingMatchInvoice] = useState<Rec | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const {
    data: procurementData,
    warnings: sourceWarnings,
    error: loadError,
    isLoading: loading,
    refetch: load,
  } = useApiQueries(
    {
      requisitions: () => getProcurementRequisitions({ status: "all" }),
      rfqs: () => getProcurementRfqs({ status: "all" }),
      orders: () => getProcurementOrders({ status: "all" }),
      suppliers: () => getProcurementSuppliers(),
      invoices: () => getProcurementInvoices({ match_status: "all" }),
      projects: () => getInternalProjects(),
      stores: () => getInventoryStores(),
      stockLevels: () => getInventoryStockLevels(),
      movements: () => getStockMovements({ limit: 300 }),
      ccbFindings: () => getCcbFindings({ status: "open" }),
      pendingPricing: () => getMaterialRequests({ is_price_confirmed: false }),
    },
    [],
    {
      criticalKeys: ["requisitions"],
      labels: {
        requisitions: "Purchase requests",
        rfqs: "Quotes",
        orders: "Purchase orders",
        suppliers: "Suppliers",
        invoices: "Invoices",
        projects: "Project register",
        stores: "Store register",
        stockLevels: "Stock levels",
        movements: "Stock movements",
        ccbFindings: "Budget warnings",
        pendingPricing: "Pending pricing",
      },
    }
  );

  useLiveTable("procurement.procurement_orders", () => void load());
  useLiveTable("procurement.purchase_requisitions", () => void load());
  useLiveTable("procurement.purchase_orders", () => void load());
  useLiveTable("procurement.rfqs", () => void load());
  useLiveTable("procurement.goods_received_notes", () => void load());
  useLiveTable("procurement.supplier_invoices", () => void load());
  useLiveTable("procurement.stock_ledger", () => void load());
  useLiveTable("procurement.inventory_items", () => void load());
  useLiveTable("procurement.stores", () => void load());
  useLiveTable("procurement.suppliers", () => void load());
  useLiveTable("finance.ccb_monitor_findings", () => void load());

  const requisitions = useMemo(() => (Array.isArray(procurementData.requisitions?.data) ? procurementData.requisitions.data : []), [procurementData.requisitions]);
  const rfqs = useMemo(() => (Array.isArray(procurementData.rfqs?.data) ? procurementData.rfqs.data : []), [procurementData.rfqs]);
  const orders = useMemo(() => (Array.isArray(procurementData.orders?.data) ? procurementData.orders.data : []), [procurementData.orders]);
  const suppliers = useMemo(() => (Array.isArray(procurementData.suppliers?.data) ? procurementData.suppliers.data : []), [procurementData.suppliers]);
  const invoices = useMemo(() => (Array.isArray(procurementData.invoices?.data) ? procurementData.invoices.data : []), [procurementData.invoices]);
  const projects = useMemo(() => (Array.isArray(procurementData.projects?.data) ? procurementData.projects.data : []), [procurementData.projects]);
  const stores = useMemo(() => (Array.isArray(procurementData.stores?.data) ? procurementData.stores.data : []), [procurementData.stores]);
  const stockLevels = useMemo(() => (Array.isArray(procurementData.stockLevels?.data) ? procurementData.stockLevels.data : []), [procurementData.stockLevels]);
  const movements = useMemo(() => (Array.isArray(procurementData.movements?.data) ? procurementData.movements.data : []), [procurementData.movements]);
  const ccbFindings = useMemo(() => (Array.isArray(procurementData.ccbFindings?.data) ? procurementData.ccbFindings.data : []), [procurementData.ccbFindings]);
  const pendingPricing = useMemo(() => (Array.isArray(procurementData.pendingPricing?.data) ? procurementData.pendingPricing.data : []), [procurementData.pendingPricing]);
  const error = loadError ? loadFailureMessage(loadError) : null;

  const kpis = useMemo(() => {
    const openPRs = requisitions.filter((r) => ["draft", "submitted"].includes(tx(r.status).toLowerCase())).length;
    const awaitingApproval = requisitions.filter((r) => tx(r.status).toLowerCase() === "submitted").length;
    const activeRFQs = rfqs.filter((r) => ["draft", "issued"].includes(tx(r.status).toLowerCase())).length;
    const activePOs = orders.filter((r) => ["approved", "issued", "partially_received"].includes(tx(r.status).toLowerCase())).length;
    const grnsPending = orders.filter((r) => tx(r.status).toLowerCase() === "partially_received").length;
    const invPending = invoices.filter((r) => ["unmatched", "partial"].includes(tx(r.match_status ?? r.matching_status).toLowerCase())).length;
    const committed = orders.filter((r) => tx(r.status).toLowerCase() !== "cancelled").reduce((s, r) => s + num(r.total_amount ?? r.amount), 0);
    return { openPRs, awaitingApproval, activePOs, grnsPending, invPending, committed, activeRFQs };
  }, [requisitions, rfqs, orders, invoices]);

  const command = useMemo(() => {
    const stockValueTotal = stockLevels.reduce((sum, row) => sum + stockValue(row), 0);
    const materialsValue = stockLevels
      .filter((row) => itemType(row.item_type) !== "tool")
      .reduce((sum, row) => sum + stockValue(row), 0);
    const toolsValue = stockLevels
      .filter((row) => itemType(row.item_type) === "tool")
      .reduce((sum, row) => sum + stockValue(row), 0);
    const lowStock = stockLevels.filter((row) => {
      const available = num(row.available_qty ?? row.quantity ?? row.stock_quantity);
      const reorder = num(row.reorder_level ?? row.reorder_point);
      return reorder > 0 && available > 0 && available <= reorder;
    });
    const outOfStock = stockLevels.filter((row) => num(row.available_qty ?? row.quantity ?? row.stock_quantity) <= 0);
    const incomingPOs = orders.filter((po) => ["issued", "partially_received"].includes(tx(po.status).toLowerCase()));
    const incomingValue = incomingPOs.reduce((sum, po) => {
      const percentReceived = Math.min(100, Math.max(0, num(po.percent_received ?? 0)));
      return sum + (num(po.total_amount ?? po.amount) * (1 - percentReceived / 100));
    }, 0);
    const overduePOs = incomingPOs.filter((po) => {
      const raw = po.expected_delivery_date ?? po.required_by_date ?? po.required_by;
      if (!raw) return false;
      const date = new Date(String(raw));
      return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
    });
    const additions = movements.filter((m) => num(m.quantity) > 0);
    const subtractions = movements.filter((m) => num(m.quantity) < 0);
    const transfers = movements.filter((m) => tx(m.movement_type).toLowerCase().includes("transfer"));
    const adjustments = movements.filter((m) => tx(m.movement_type).toLowerCase() === "adjustment");
    const storeSummaries = stores.map((store) => {
      const rows = stockLevels.filter((stock) => tx(stock.store_id, "") === String(store.id) || tx(stock.store_name, "") === tx(store.name ?? store.store_name, ""));
      return {
        ...store,
        itemCount: rows.filter((row) => num(row.available_qty ?? row.quantity ?? row.stock_quantity) !== 0).length,
        value: rows.reduce((sum, row) => sum + stockValue(row), 0),
      };
    }).sort((a, b) => num(b.value) - num(a.value));
    const actionQueue = [
      ...pendingPricing.slice(0, 8).map((row) => ({ id: `price-${row.id}`, tone: "amber" as const, label: "Confirm price", title: tx(row.request_number, row.id), meta: `${tx(row.project_name)} · ${tx(row.item_name ?? row.item_code)}` })),
      ...requisitions.filter((row) => tx(row.status).toLowerCase() === "submitted").slice(0, 8).map((row) => ({ id: `pr-${row.id}`, tone: "blue" as const, label: "Approve request", title: tx(row.requisition_number ?? row.pr_number, row.id), meta: `${tx(row.project_name)} · ${money(row.total_estimated)}` })),
      ...rfqs.filter((row) => ["issued", "draft"].includes(tx(row.status).toLowerCase())).slice(0, 8).map((row) => ({ id: `rfq-${row.id}`, tone: "slate" as const, label: "Quotes open", title: tx(row.rfq_number, row.id), meta: tx(row.project_name) })),
      ...overduePOs.slice(0, 8).map((row) => ({ id: `po-${row.id}`, tone: "red" as const, label: "PO overdue", title: tx(row.po_number, row.id), meta: `${tx(row.supplier_name)} · ${dt(row.expected_delivery_date ?? row.required_by_date)}` })),
      ...ccbFindings.slice(0, 8).map((row) => ({ id: `ccb-${row.id}`, tone: "red" as const, label: "Budget warning", title: tx(row.title ?? row.check_type, row.id), meta: tx(row.project_name ?? row.status) })),
    ].slice(0, 12);
    return {
      stockValueTotal,
      materialsValue,
      toolsValue,
      lowStock,
      outOfStock,
      incomingPOs,
      incomingValue,
      overduePOs,
      additions,
      subtractions,
      transfers,
      adjustments,
      storeSummaries,
      actionQueue,
      recentMovements: [...movements].sort((a, b) => movementDate(b) - movementDate(a)).slice(0, 12),
    };
  }, [stockLevels, movements, stores, orders, pendingPricing, requisitions, rfqs, ccbFindings]);

  const submitPR = async (id: string, overrideReason?: string) => {
    setSaving(`submit-${id}`);
    try {
      await submitProcurementRequisition(id, overrideReason);
      setNotice("Purchase request submitted for approval.");
      setOverridePromptFor(null);
      await load();
    } catch (e) {
      const message = normalizeActionError(e, "Submission failed.");
      if (/override reason/i.test(message)) {
        setOverridePromptFor({ id, action: "submit", message });
      } else {
        setNotice(message);
      }
    }
    finally { setSaving(null); }
  };

  const decidePR = async (id: string, decision: "approved" | "rejected", reason?: string, overrideReason?: string) => {
    setSaving(`decide-${id}`);
    try {
      await approveProcurementRequisition(id, decision, reason, overrideReason);
      setNotice(`Requisition ${decision}.`);
      setApprovingPR(null);
      setOverridePromptFor(null);
      await load();
    } catch (e) {
      const message = normalizeActionError(e, "Decision failed.");
      if (/override reason/i.test(message)) {
        setApprovingPR(null);
        setOverridePromptFor({ id, action: "approve", message, decisionReason: reason });
      } else {
        setNotice(message);
      }
    }
    finally { setSaving(null); }
  };

  const createPO = async (pr: Rec, supplierId: string, supplierSelectionReason: string) => {
    setSaving(`po-${pr.id}`);
    try {
      await createPurchaseOrderFromRequisition({ requisition_id: pr.id, supplier_id: supplierId, notes: supplierSelectionReason });
      setNotice("Purchase order created from the approved request.");
      setCreatingPOFromPR(null);
      router.push(TAB_ROUTES.orders);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Purchase order creation failed.")); }
    finally { setSaving(null); }
  };

  const createRfq = async (pr: Rec, payload: Record<string, unknown>) => {
    setSaving(`rfq-${pr.id}`);
    try {
      await createProcurementRfq({ requisition_id: pr.id, ...payload });
      setNotice("Quote request sent to suppliers.");
      setCreatingRfqFromPR(null);
      router.push(TAB_ROUTES.rfqs);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Could not send the quote request.")); }
    finally { setSaving(null); }
  };

  const recordQuote = async (rfq: Rec, payload: Record<string, unknown>) => {
    setSaving(`quote-${rfq.id}`);
    try {
      await recordProcurementRfqResponse(rfq.id, payload);
      setNotice("Supplier quotation recorded.");
      setQuotingRfq(null);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Supplier quotation failed.")); }
    finally { setSaving(null); }
  };

  const decideQuote = async (rfq: Rec, response: Rec, decision: "selected" | "rejected" | "evaluated") => {
    setSaving(`quote-decision-${response.id}`);
    try {
      await decideProcurementRfqResponse(rfq.id, response.id, { decision, evaluation_score: decision === "selected" ? 100 : undefined });
      setNotice(`Supplier quotation ${decision}.`);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Quotation decision failed.")); }
    finally { setSaving(null); }
  };

  const createPOFromQuote = async (response: Rec) => {
    setSaving(`po-rfq-${response.id}`);
    try {
      await createPurchaseOrderFromRfq({ rfq_response_id: response.id });
      setNotice("Purchase order created from selected supplier quotation.");
      router.push(TAB_ROUTES.orders);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Purchase order creation from quotation failed.")); }
    finally { setSaving(null); }
  };

  const issuePO = async (po: Rec) => {
    setSaving(`issue-po-${po.id}`);
    try {
      await issuePurchaseOrder(po.id);
      setNotice("Purchase order sent to the supplier and budget reserved.");
      setSelectedPO(null);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Purchase order issue failed.")); }
    finally { setSaving(null); }
  };

  const approvePO = async (po: Rec) => {
    setSaving(`approve-po-${po.id}`);
    try {
      await approvePurchaseOrder(po.id, "approved");
      setNotice("Purchase order approved for issue.");
      setSelectedPO(null);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Purchase order approval failed.")); }
    finally { setSaving(null); }
  };

  const receivePO = async (payload: Record<string, unknown>) => {
    setSaving("receive-po");
    try {
      await recordGoodsReceived(payload);
      setNotice("Goods received and stock ledger updated.");
      setReceivingPO(null);
      setSelectedPO(null);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Goods receipt failed.")); }
    finally { setSaving(null); }
  };

  const registerInvoice = async (payload: Record<string, unknown>) => {
    setSaving("invoice-po");
    try {
      await registerSupplierInvoice(payload);
      setNotice("Supplier invoice registered.");
      setInvoicingPO(null);
      setSelectedPO(null);
      router.push(TAB_ROUTES.invoices);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Invoice registration failed.")); }
    finally { setSaving(null); }
  };

  const confirmPricing = async (requestId: string, unitCost: number) => {
    setSaving(`price-${requestId}`);
    try {
      await confirmMaterialRequestPrice(requestId, unitCost);
      setNotice("Material request price confirmed.");
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Price could not be confirmed.")); }
    finally { setSaving(null); }
  };

  const matchInvoice = async (invoice: Rec) => {
    if (!invoice.po_id || !invoice.grn_id) {
      setNotice("This is a store-only invoice intake. It is saved against stores and does not need PO matching.");
      return;
    }
    setSaving(`match-invoice-${invoice.id}`);
    try {
      await matchSupplierInvoice(invoice.id);
      setNotice("Invoice checked against the order and delivery.");
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Invoice matching failed.")); }
    finally { setSaving(null); }
  };

  const approveInvoicePayment = async (invoice: Rec, evidence: PaymentEvidencePayload) => {
    setSaving(`pay-invoice-${invoice.id}`);
    try {
      if (!invoice.po_id || !invoice.grn_id) {
        throw new Error("Payment approval requires this invoice to be linked to a purchase order and confirmed goods receipt.");
      }
      await linkProcurementDocument({
        entity_type: "purchase_order",
        entity_id: invoice.po_id,
        document_id: evidence.poDocumentId,
        link_role: "purchase_order",
      });
      await linkProcurementDocument({
        entity_type: "goods_received_note",
        entity_id: invoice.grn_id,
        document_id: evidence.grnDocumentId,
        link_role: "goods_receipt",
      });
      await linkProcurementDocument({
        entity_type: "supplier_invoice",
        entity_id: invoice.id,
        document_id: evidence.invoiceDocumentId,
        link_role: "supplier_invoice",
      });
      await decideSupplierInvoicePayment(invoice.id, "approved", evidence.reason, evidence.approvalDocumentId);
      setPaymentEvidenceInvoice(null);
      setNotice("Payment approved, with the order, delivery, invoice and approval documents attached.");
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Payment approval failed.")); }
    finally { setSaving(null); }
  };

  const filteredPRs = useMemo(() => {
    const q = query.toLowerCase();
    return requisitions.filter((r) => prStatus === "all" || tx(r.status, "draft").toLowerCase() === prStatus).filter((r) => `${r.pr_number ?? r.reference_number ?? r.id} ${r.project_name ?? ""} ${r.requested_by ?? ""} ${r.status ?? ""}`.toLowerCase().includes(q));
  }, [requisitions, query, prStatus]);

  const filteredPricing = useMemo(() => {
    const q = query.toLowerCase();
    return pendingPricing.filter((r) => `${r.request_number ?? r.id} ${r.project_name ?? ""} ${r.item_name ?? ""}`.toLowerCase().includes(q));
  }, [pendingPricing, query]);

  const filteredPOs = useMemo(() => {
    const q = query.toLowerCase();
    return orders.filter((r) => poStatus === "all" || (poStatus === "overdue" ? isPoOverdue(r) : tx(r.status, "draft").toLowerCase() === poStatus)).filter((r) => `${r.po_number ?? r.reference_number ?? r.id} ${r.supplier_name ?? ""} ${r.project_name ?? ""} ${r.status ?? ""}`.toLowerCase().includes(q));
  }, [orders, query, poStatus]);

  const filteredRfqs = useMemo(() => {
    const q = query.toLowerCase();
    return rfqs.filter((r) => rfqStatus === "all" || tx(r.status, "draft").toLowerCase() === rfqStatus).filter((r) => `${r.rfq_number ?? r.id} ${r.requisition_number ?? ""} ${r.project_name ?? ""} ${r.status ?? ""}`.toLowerCase().includes(q));
  }, [rfqs, query, rfqStatus]);

  const filteredSuppliers = useMemo(() => {
    const q = query.toLowerCase();
    return suppliers.filter((r) => supplierCompliance === "all" || tx(r.compliance_status, "pending").toLowerCase() === supplierCompliance).filter((r) => `${r.name ?? r.supplier_name ?? ""} ${r.code ?? r.supplier_code ?? ""} ${r.praz_number ?? ""}`.toLowerCase().includes(q));
  }, [suppliers, query, supplierCompliance]);

  const filteredInvoices = useMemo(() => {
    const q = query.toLowerCase();
    return invoices.filter((r) => invMatchStatus === "all" || tx(r.match_status ?? r.matching_status, "unmatched").toLowerCase() === invMatchStatus).filter((r) => `${r.invoice_number ?? r.id} ${r.supplier_name ?? ""} ${r.po_number ?? ""} ${r.match_status ?? ""}`.toLowerCase().includes(q));
  }, [invoices, query, invMatchStatus]);

  const unmatchedCount = useMemo(
    () => filteredInvoices.filter((r) => ["unmatched", "disputed"].includes(tx(r.match_status ?? r.matching_status).toLowerCase())).length,
    [filteredInvoices]
  );

  return (
    <main className="min-h-full bg-ink p-4 text-paper sm:p-6">
      <DashboardPageHeader
        eyebrow={{ label: "Procurement", icon: ClipboardList }}
        title={PROCUREMENT_TAB_META[tab].title}
        subtitle={PROCUREMENT_TAB_META[tab].subtitle}
        className="mb-4 pb-4"
        actions={
          <>
            {tab === "suppliers" ? (
              <button onClick={() => setShowAddSupplier(true)} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90">
                <Plus className="h-4 w-4" />New Supplier
              </button>
            ) : tab === "command" || tab === "requisitions" ? (
              <button onClick={() => setShowCreatePR(true)} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90">
                <Plus className="h-4 w-4" />New Requisition
              </button>
            ) : null}
            <button onClick={() => void load()} disabled={loading} title="Refresh" className="inline-flex h-9 w-9 items-center justify-center border border-ink-mid bg-ink-light text-slate-light hover:border-signal hover:text-paper disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </>
        }
      />

      <SupplyControlTower currentModule="procurement" />

      {/* Where this page sits in the requisition-to-payment flow, with what is
          waiting at each stage - the same strip on every tab, but the active
          stage and its counts are what change as work moves through. */}
      <nav className="mb-4 grid grid-cols-2 gap-px border border-ink-mid bg-ink-mid sm:grid-cols-3 lg:grid-cols-6">
        {[
          { key: "requisitions" as Tab, label: "Purchase requests", value: kpis.awaitingApproval, sub: `${kpis.openPRs} open`, hot: kpis.awaitingApproval > 0, verb: "to approve" },
          { key: "pricing" as Tab, label: "Pricing", value: pendingPricing.length, sub: "site requests", hot: pendingPricing.length > 0, verb: "to price" },
          { key: "rfqs" as Tab, label: "Quotes", value: kpis.activeRFQs, sub: "out to suppliers", hot: false, verb: "open" },
          { key: "orders" as Tab, label: "Purchase orders", value: kpis.activePOs, sub: `${command.overduePOs.length} overdue`, hot: command.overduePOs.length > 0, verb: "in flight" },
          { key: "invoices" as Tab, label: "Invoices", value: kpis.invPending, sub: "to check", hot: kpis.invPending > 0, verb: "pending" },
          { key: "suppliers" as Tab, label: "Suppliers", value: suppliers.length, sub: `${suppliers.filter((r) => tx(r.compliance_status, "pending").toLowerCase() !== "compliant").length} not compliant`, hot: false, verb: "registered" },
        ].map((stage) => {
          const active = tab === stage.key;
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => router.push(TAB_ROUTES[stage.key])}
              className={`relative px-3 py-2.5 text-left transition-colors ${active ? "bg-signal/15" : "bg-ink hover:bg-ink-light"}`}
            >
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-signal" />}
              <p className={`font-mono text-[10px] uppercase tracking-wider ${active ? "text-signal" : "text-slate"}`}>{stage.label}</p>
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className={`font-mono text-lg font-semibold ${stage.hot ? "text-amber-300" : "text-paper"}`}>{loading ? "…" : stage.value}</span>
                <span className="text-[11px] text-slate-light">{stage.verb}</span>
              </p>
              <p className="truncate text-[11px] text-slate">{stage.sub}</p>
            </button>
          );
        })}
      </nav>

      {/* Alerts */}
      {error && <Banner tone="error" message={error} />}
      {sourceWarnings.length > 0 && <div className="mb-4 space-y-2">{sourceWarnings.map((warning) => <Banner key={warning} tone="info" message={warning} />)}</div>}
      {notice && <Banner tone="info" message={notice} onClose={() => setNotice(null)} />}

      {/* Filter bar: search plus status chips that carry live counts */}
      {tab !== "command" && <div className="flex flex-col gap-2 border border-b-0 border-ink-mid bg-ink-light/30 p-3 lg:flex-row lg:items-center">
        <label className="flex h-9 items-center gap-2 border border-ink-mid bg-ink px-3 lg:w-72">
          <Search className="h-3.5 w-3.5 text-slate" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${PROCUREMENT_TAB_META[tab].title.toLowerCase()}…`} className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate" />
        </label>
        {tab === "requisitions" && (
          <StatusChips value={prStatus} onChange={setPrStatus} rows={requisitions} statusOf={(r) => tx(r.status, "draft").toLowerCase()} amountOf={(r) => num(r.total_estimated ?? r.estimated_total)}
            options={[["draft", "Draft"], ["submitted", "Awaiting approval"], ["approved", "Approved"], ["ordered", "Ordered"], ["rejected", "Rejected"]]} />
        )}
        {tab === "rfqs" && (
          <StatusChips value={rfqStatus} onChange={setRfqStatus} rows={rfqs} statusOf={(r) => tx(r.status, "draft").toLowerCase()}
            options={[["draft", "Draft"], ["issued", "Issued"], ["closed", "Closed"], ["cancelled", "Cancelled"]]} />
        )}
        {tab === "orders" && (
          <StatusChips value={poStatus} onChange={setPoStatus} rows={orders} statusOf={(r) => tx(r.status, "draft").toLowerCase()} amountOf={(r) => num(r.total_amount ?? r.amount)}
            extra={{ key: "overdue", label: "Overdue", count: orders.filter(isPoOverdue).length }}
            options={[["draft", "Draft"], ["approved", "Approved"], ["issued", "Issued"], ["partially_received", "Part received"], ["received", "Received"], ["cancelled", "Cancelled"]]} />
        )}
        {tab === "invoices" && (
          <StatusChips value={invMatchStatus} onChange={setInvMatchStatus} rows={invoices} statusOf={(r) => tx(r.match_status ?? r.matching_status, "unmatched").toLowerCase()} amountOf={(r) => num(r.total_amount ?? r.amount)}
            options={[["unmatched", "Unmatched"], ["partial", "Partial"], ["matched", "Matched"], ["disputed", "Disputed"]]} />
        )}
        {tab === "suppliers" && (
          <StatusChips value={supplierCompliance} onChange={setSupplierCompliance} rows={suppliers} statusOf={(r) => tx(r.compliance_status, "pending").toLowerCase()}
            options={[["compliant", "Compliant"], ["pending", "Pending"], ["non_compliant", "Non-compliant"], ["exempt", "Exempt"]]} />
        )}
      </div>}

      {/* Tab content */}
      <section className="border border-t-0 border-ink-mid bg-ink">
        {loading && !procurementData.requisitions ? <LoadingState label={`Loading ${tab}…`} /> :
          tab === "command" ? <ProcurementCommandDashboard command={command} loading={loading} /> :
          tab === "requisitions" ? <RequisitionsTable rows={filteredPRs} saving={saving} onSubmit={submitPR} onApprove={setApprovingPR} onCreateRFQ={setCreatingRfqFromPR} onCreatePO={setCreatingPOFromPR} /> :
          tab === "rfqs" ? <RfqsTab rows={filteredRfqs} saving={saving} onQuote={setQuotingRfq} onDecideQuote={decideQuote} onCreatePO={createPOFromQuote} /> :
          tab === "orders" ? <OrdersTable rows={filteredPOs} onView={setSelectedPO} /> :
          tab === "suppliers" ? <SuppliersTable rows={filteredSuppliers} onView={setViewingSupplier} /> :
          tab === "pricing" ? <PendingPricingTable rows={filteredPricing} saving={saving} onConfirm={confirmPricing} /> :
          <InvoicesTab
            rows={filteredInvoices}
            unmatchedCount={unmatchedCount}
            saving={saving}
            onMatch={matchInvoice}
            onInspect={(inv) => setInspectingMatchInvoice(inv)}
            onApprovePayment={setPaymentEvidenceInvoice}
          />
        }
      </section>

      {/* Modals */}
      {inspectingMatchInvoice && (
        <ThreeWayMatchInspectorModal
          invoice={inspectingMatchInvoice}
          onClose={() => setInspectingMatchInvoice(null)}
          onMatch={matchInvoice}
          onApprovePayment={(inv) => {
            setInspectingMatchInvoice(null);
            setPaymentEvidenceInvoice(inv);
          }}
          saving={saving}
        />
      )}
      {showCreatePR && (
        <CreatePRModal
          projects={projects}
          stores={stores}
          stockLevels={stockLevels}
          onClose={() => setShowCreatePR(false)}
          onCreated={() => {
            setShowCreatePR(false);
            setNotice("Purchase request created.");
            void load();
          }}
        />
      )}
      {showAddSupplier && (
        <AddSupplierModal
          onClose={() => setShowAddSupplier(false)}
          onCreated={(temporaryPassword, email) => {
            setShowAddSupplier(false);
            setNotice("Supplier registered.");
            if (temporaryPassword && email) setIssuedSupplierCredentials({ email, temporary_password: temporaryPassword });
            void load();
          }}
        />
      )}
      {issuedSupplierCredentials && (
        <CredentialsIssuedModal credentials={issuedSupplierCredentials} onClose={() => setIssuedSupplierCredentials(null)} />
      )}
      {viewingSupplier && (
        <Supplier360Modal
          supplier={viewingSupplier}
          onClose={() => setViewingSupplier(null)}
          onSaved={(updatedSupplier) => {
            setViewingSupplier(updatedSupplier);
            setNotice("Supplier updated.");
            void load();
          }}
          onCredentials={(credentials) => setIssuedSupplierCredentials(credentials)}
        />
      )}
      {selectedPO && <PODetailDrawer po={selectedPO} saving={saving} onApprove={approvePO} onIssue={issuePO} onReceive={setReceivingPO} onInvoice={setInvoicingPO} onMatchInvoice={matchInvoice} onApprovePayment={setPaymentEvidenceInvoice} onClose={() => setSelectedPO(null)} />}
      {approvingPR && <ApproveModal pr={approvingPR} saving={saving?.startsWith("decide-") ?? false} onDecide={(d, r) => void decidePR(approvingPR.id, d, r)} onClose={() => setApprovingPR(null)} />}
      {overridePromptFor && (
        <OverrideReasonModal
          message={overridePromptFor.message}
          saving={saving === `submit-${overridePromptFor.id}` || saving === `decide-${overridePromptFor.id}`}
          onConfirm={(reason) => {
            if (overridePromptFor.action === "submit") void submitPR(overridePromptFor.id, reason);
            else void decidePR(overridePromptFor.id, "approved", overridePromptFor.decisionReason, reason);
          }}
          onClose={() => setOverridePromptFor(null)}
        />
      )}
      {creatingRfqFromPR && <CreateRfqModal pr={creatingRfqFromPR} saving={saving === `rfq-${creatingRfqFromPR.id}`} onCreate={(payload) => void createRfq(creatingRfqFromPR, payload)} onClose={() => setCreatingRfqFromPR(null)} />}
      {creatingPOFromPR && <CreatePOModal pr={creatingPOFromPR} suppliers={suppliers} saving={saving === `po-${creatingPOFromPR.id}`} onCreate={(supplierId, supplierSelectionReason) => void createPO(creatingPOFromPR, supplierId, supplierSelectionReason)} onClose={() => setCreatingPOFromPR(null)} />}
      {quotingRfq && <RfqResponseModal rfq={quotingRfq} suppliers={suppliers} saving={saving === `quote-${quotingRfq.id}`} onSubmit={(payload) => void recordQuote(quotingRfq, payload)} onClose={() => setQuotingRfq(null)} />}
      {receivingPO && <ReceiveGoodsModal po={receivingPO} stores={stores} saving={saving === "receive-po"} onSubmit={receivePO} onClose={() => setReceivingPO(null)} />}
      {invoicingPO && <SupplierInvoiceModal po={invoicingPO} saving={saving === "invoice-po"} onSubmit={registerInvoice} onClose={() => setInvoicingPO(null)} />}
      {paymentEvidenceInvoice && <PaymentEvidenceModal invoice={paymentEvidenceInvoice} saving={saving === `pay-invoice-${paymentEvidenceInvoice.id}`} onSubmit={(payload) => void approveInvoicePayment(paymentEvidenceInvoice, payload)} onClose={() => setPaymentEvidenceInvoice(null)} />}
    </main>
  );
}


function OverrideReasonModal({ message, saving, onConfirm, onClose }: { message: string; saving: boolean; onConfirm: (reason: string) => void; onClose: () => void; }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-amber-400">Budget Override Required</p>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3 border border-amber-500/20 bg-amber-950/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-200">{message}</p>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Override reason (required, audited)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why this should proceed above the approved budget…" className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper resize-none" />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={saving || !reason.trim()} className="inline-flex h-9 items-center gap-1.5 bg-amber-600 px-4 font-mono text-xs font-bold uppercase text-white hover:bg-amber-500 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}Proceed With Override
          </button>
        </footer>
      </div>
    </div>
  );
}
