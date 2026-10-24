"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardList, ListChecks, Loader2, Package, Plus, RefreshCw, Search, ShieldAlert, ShoppingCart, X } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { SupplyControlTower } from "@/components/supply/SupplyControlTower";
import { ThreeWayMatchInspectorModal } from "@/components/supply/ThreeWayMatchInspectorModal";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { approvePurchaseOrder, approveProcurementRequisition, createProcurementRfq, createPurchaseOrderFromRequisition, createPurchaseOrderFromRfq, decideProcurementRfqResponse, decideSupplierInvoicePayment, confirmMaterialRequestPrice, getCcbFindings, getInternalProjects, getInventoryStores, getInventoryStockLevels, getMaterialRequests, getProcurementInvoices, getProcurementOrders, getProcurementRequisitions, getProcurementRfqs, getProcurementSuppliers, issuePurchaseOrder, linkProcurementDocument, matchSupplierInvoice, recordProcurementRfqResponse, recordGoodsReceived, registerSupplierInvoice, submitProcurementRequisition } from "@/lib/api";
import { InvoicesTab, PaymentEvidenceModal } from "@/components/procurement/invoices";
import { OrdersTable, PODetailDrawer, ReceiveGoodsModal, SupplierInvoiceModal } from "@/components/procurement/orders";
import { buildPurchases, buildTasks, type TaskAction } from "@/components/procurement/journey";
import { PURCHASE_FILTERS, PurchasesView, matchesPurchaseFilter } from "@/components/procurement/purchases";
import { MyTasks } from "@/components/procurement/tasks";
import { ApproveModal, CreatePOModal, CreatePRModal, CreateRfqModal, PendingPricingTable, RequisitionsTable, RfqResponseModal, RfqsTab } from "@/components/procurement/requests";
import { Banner, LoadingState, type PaymentEvidencePayload, type Rec, StatusChips, type Tab, isPoOverdue, loadFailureMessage, normalizeActionError, num, tx } from "@/components/procurement/shared";
import { AddSupplierModal, CredentialsIssuedModal, Supplier360Modal, SuppliersTable } from "@/components/procurement/suppliers";


const PROCUREMENT_TAB_META: Record<Tab, { title: string; subtitle: string }> = {
  tasks: { title: "My Tasks", subtitle: "Everything in procurement that is waiting on you - urgent first. Each task opens the right form." },
  purchases: { title: "Purchases", subtitle: "Every purchase from request to payment on one line: where it is and what it is waiting on." },
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
  const known: Tab[] = ["tasks", "purchases", "requisitions", "rfqs", "orders", "suppliers", "invoices", "pricing"];
  // "command" was the old overview tab; its stock panels now live in Inventory.
  const initialTab: Tab = known.includes(requestedTab as Tab) ? (requestedTab as Tab) : "tasks";

  return (
    <RBACGuard>
      <ProcurementWorkspace initialTab={initialTab} />
    </RBACGuard>
  );
}


// ─── Workspace ────────────────────────────────────────────────────────────────

const TAB_ROUTES: Record<Tab, string> = {
  tasks: "/dashboard/procurement",
  purchases: "/dashboard/procurement/purchases",
  requisitions: "/dashboard/procurement/requisitions",
  rfqs: "/dashboard/procurement/rfqs",
  orders: "/dashboard/procurement/purchase-orders",
  suppliers: "/dashboard/procurement/suppliers",
  invoices: "/dashboard/procurement/invoices",
  pricing: "/dashboard/procurement/pricing",
};


function ProcurementWorkspace({ initialTab = "tasks" }: { initialTab?: Tab }) {
  const router = useRouter();
  const { user, permissions, isSuperAdmin } = useAuth();
  const [purchaseFilter, setPurchaseFilter] = useState("all");
  const [expandedPurchase, setExpandedPurchase] = useState<string | null>(null);
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
  const ccbFindings = useMemo(() => (Array.isArray(procurementData.ccbFindings?.data) ? procurementData.ccbFindings.data : []), [procurementData.ccbFindings]);
  const pendingPricing = useMemo(() => (Array.isArray(procurementData.pendingPricing?.data) ? procurementData.pendingPricing.data : []), [procurementData.pendingPricing]);
  const error = loadError ? loadFailureMessage(loadError) : null;

  const purchases = useMemo(() => buildPurchases(requisitions, rfqs, orders, invoices), [requisitions, rfqs, orders, invoices]);
  const can = useMemo(() => (key: string) => isSuperAdmin || Boolean(permissions?.has(key)), [isSuperAdmin, permissions]);
  const tasks = useMemo(() => buildTasks(purchases, can, user?.id ?? null), [purchases, can, user?.id]);
  const canPrice = can("procurement.requisition.approve");
  const taskCount = tasks.length + (canPrice ? pendingPricing.length : 0);
  const activePurchases = purchases.filter((p) => p.stage !== "done" && p.stage !== "stopped").length;
  const overduePurchases = purchases.filter((p) => p.overdue).length;

  const openPurchase = (purchaseId: string) => {
    setExpandedPurchase(purchaseId);
    setPurchaseFilter("all");
    setQuery("");
    if (tab !== "purchases") router.push(TAB_ROUTES.purchases);
  };

  const runTask = (action: TaskAction) => {
    switch (action.type) {
      case "submitRequest": void submitPR(action.row.id); break;
      case "approveRequest": setApprovingPR(action.row); break;
      case "createPO": setCreatingPOFromPR(action.row); break;
      case "openPurchase": openPurchase(action.purchaseId); break;
      case "openPO": setSelectedPO(action.row); break;
      case "receivePO": setReceivingPO(action.row); break;
      case "invoicePO": setInvoicingPO(action.row); break;
      case "checkInvoice": setInspectingMatchInvoice(action.row); break;
      case "approvePayment": setPaymentEvidenceInvoice(action.row); break;
    }
  };

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
      openPurchase(`req-${pr.id}`);
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
      openPurchase(`req-${pr.id}`);
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
      setNotice("Purchase order created from the selected supplier quote.");
      if (response.rfq_id) {
        const rfq = rfqs.find((r) => String(r.id) === String(response.rfq_id));
        if (rfq?.requisition_id) openPurchase(`req-${rfq.requisition_id}`);
      }
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

  const filteredPurchases = useMemo(() => {
    const q = query.toLowerCase();
    return purchases
      .filter((p) => matchesPurchaseFilter(p, purchaseFilter))
      .filter((p) => !q || [p.number, p.project, p.title, ...p.orders.map((o) => `${o.po_number ?? ""} ${o.supplier_name ?? ""}`), ...p.invoices.map((i) => String(i.invoice_number ?? ""))].join(" ").toLowerCase().includes(q));
  }, [purchases, purchaseFilter, query]);

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
            ) : tab === "tasks" || tab === "purchases" || tab === "requisitions" ? (
              <button onClick={() => setShowCreatePR(true)} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90">
                <Plus className="h-4 w-4" />New request
              </button>
            ) : null}
            <button onClick={() => void load()} disabled={loading} title="Refresh" className="inline-flex h-9 w-9 items-center justify-center border border-ink-mid bg-ink-light text-slate-light hover:border-signal hover:text-paper disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </>
        }
      />

      <SupplyControlTower currentModule="procurement" />

      {/* Three main views. The detailed lists (requests, quotes, orders,
          invoices, pricing) stay reachable from Purchases and their old URLs. */}
      <nav className="mb-4 grid grid-cols-3 gap-px border border-ink-mid bg-ink-mid">
        {[
          { key: "tasks" as Tab, label: "My Tasks", icon: ListChecks, value: taskCount, sub: taskCount ? "waiting on you" : "all caught up", hot: taskCount > 0 },
          { key: "purchases" as Tab, label: "Purchases", icon: ShoppingCart, value: activePurchases, sub: overduePurchases ? `in progress · ${overduePurchases} late` : "in progress", hot: overduePurchases > 0 },
          { key: "suppliers" as Tab, label: "Suppliers", icon: Package, value: suppliers.length, sub: `${suppliers.filter((r) => tx(r.compliance_status, "pending").toLowerCase() !== "compliant").length} not compliant`, hot: false },
        ].map((view) => {
          const active = tab === view.key || (view.key === "purchases" && ["requisitions", "rfqs", "orders", "invoices", "pricing"].includes(tab));
          const Icon = view.icon;
          return (
            <button key={view.key} type="button" onClick={() => router.push(TAB_ROUTES[view.key])}
              className={`relative px-4 py-3 text-left transition-colors ${active ? "bg-signal/15" : "bg-ink hover:bg-ink-light"}`}>
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-signal" />}
              <p className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider ${active ? "text-signal" : "text-slate-light"}`}><Icon className="h-3.5 w-3.5" />{view.label}</p>
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className={`font-mono text-xl font-semibold ${view.hot ? "text-amber-300" : "text-paper"}`}>{loading ? "…" : view.value}</span>
                <span className="truncate text-[11px] text-slate">{view.sub}</span>
              </p>
            </button>
          );
        })}
      </nav>
      {["requisitions", "rfqs", "orders", "invoices", "pricing"].includes(tab) && (
        <button onClick={() => router.push(TAB_ROUTES.purchases)} className="mb-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase text-slate-light hover:text-paper">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Purchases
        </button>
      )}

      {/* Alerts */}
      {error && <Banner tone="error" message={error} />}
      {sourceWarnings.length > 0 && <div className="mb-4 space-y-2">{sourceWarnings.map((warning) => <Banner key={warning} tone="info" message={warning} />)}</div>}
      {notice && <Banner tone="info" message={notice} onClose={() => setNotice(null)} />}

      {/* Filter bar: search plus status chips that carry live counts */}
      {tab !== "tasks" && <div className="flex flex-col gap-2 border border-b-0 border-ink-mid bg-ink-light/30 p-3 lg:flex-row lg:items-center">
        <label className="flex h-9 items-center gap-2 border border-ink-mid bg-ink px-3 lg:w-72">
          <Search className="h-3.5 w-3.5 text-slate" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${PROCUREMENT_TAB_META[tab].title.toLowerCase()}…`} className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate" />
        </label>
        {tab === "purchases" && (
          <StatusChips value={purchaseFilter} onChange={setPurchaseFilter} rows={purchases as unknown as Rec[]} statusOf={(r) => String(r.stage)} amountOf={(r) => num(r.amount)}
            extra={{ key: "overdue", label: "Late", count: overduePurchases }}
            options={PURCHASE_FILTERS.filter(([key]) => key !== "active")} />
        )}
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
          tab === "tasks" ? <MyTasks tasks={tasks} pricing={filteredPricing} canPrice={canPrice} saving={saving} onAct={runTask} onConfirmPrice={confirmPricing} /> :
          tab === "purchases" ? (
            <PurchasesView
              purchases={filteredPurchases}
              expandedId={expandedPurchase}
              onToggle={setExpandedPurchase}
              saving={saving}
              requestHandlers={{ onSubmit: submitPR, onApprove: setApprovingPR, onCreateRFQ: setCreatingRfqFromPR, onCreatePO: setCreatingPOFromPR }}
              rfqHandlers={{ onQuote: setQuotingRfq, onDecideQuote: decideQuote, onCreatePO: createPOFromQuote }}
              onViewOrder={setSelectedPO}
              invoiceHandlers={{ onMatch: matchInvoice, onInspect: (inv) => setInspectingMatchInvoice(inv), onApprovePayment: setPaymentEvidenceInvoice }}
            />
          ) :
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
