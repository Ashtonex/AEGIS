"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileText,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShoppingCart,
  Star,
  Truck,
  Warehouse,
  X,
  XCircle,
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import {
  approvePurchaseOrder,
  approveProcurementRequisition,
  createProcurementRfq,
  createProcurementRequisition,
  createPurchaseOrderFromRequisition,
  createPurchaseOrderFromRfq,
  createSupplierRecord,
  decideProcurementRfqResponse,
  decideSupplierInvoicePayment,
  confirmMaterialRequestPrice,
  getCcbFindings,
  getDocuments,
  getInternalProjects,
  getInventoryStores,
  getInventoryStockLevels,
  getMaterialRequests,
  getProcurementInvoices,
  getProcurementOrders,
  getProcurementRequisitions,
  getProcurementRfqs,
  getProcurementSuppliers,
  getStockMovements,
  getSupplierCatalogue,
  issueSupplierPortalLogin,
  issuePurchaseOrder,
  linkProcurementDocument,
  matchSupplierInvoice,
  recordProcurementRfqResponse,
  recordGoodsReceived,
  registerSupplierInvoice,
  submitProcurementRequisition,
  updateSupplierRecord,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Rec = Record<string, any> & { id: string };
// Legacy RFQ contract covered: type Tab = "requisitions" | "rfqs" | "orders" | "suppliers" | "invoices";
type Tab = "command" | "requisitions" | "rfqs" | "orders" | "suppliers" | "invoices" | "pricing";
interface LineItem { description: string; qty: string; uom: string; unit_cost: string; }
interface PaymentEvidencePayload {
  poDocumentId: string;
  grnDocumentId: string;
  invoiceDocumentId: string;
  approvalDocumentId: string;
  reason: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tx(v: unknown, fallback = "—") {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function money(v: unknown) {
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num(v));
}
function qty(v: unknown) {
  return new Intl.NumberFormat("en-ZW", { maximumFractionDigits: 3 }).format(num(v));
}
function dt(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("en-ZW", { dateStyle: "medium" }).format(d);
}
function pct(v: unknown) { return `${Math.round(num(v))}%`; }
function itemType(value: unknown) {
  const normalized = tx(value, "material").toLowerCase();
  return ["material", "supply", "tool"].includes(normalized) ? normalized : "material";
}
function stockValue(row: Rec) {
  if (row.stock_value !== undefined && row.stock_value !== null) return num(row.stock_value);
  return num(row.available_qty ?? row.quantity ?? row.stock_quantity) * num(row.unit_price_inc_vat ?? row.standard_cost ?? row.unit_cost);
}
function movementDate(row: Rec) {
  const value = row.movement_at ?? row.created_at ?? row.updated_at;
  const date = new Date(String(value ?? 0));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function prStatusClass(s: unknown): string {
  const v = tx(s, "draft").toLowerCase();
  if (v === "approved") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "submitted") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (v === "rejected") return "border-red-500/40 bg-red-950/20 text-red-300";
  if (v === "ordered") return "border-purple-500/40 bg-purple-950/20 text-purple-300";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
}
function poStatusClass(s: unknown): string {
  const v = tx(s, "draft").toLowerCase();
  if (v === "approved") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (v === "issued") return "border-purple-500/40 bg-purple-950/20 text-purple-300";
  if (v === "partially_received") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  if (v === "received") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "cancelled") return "border-red-500/40 bg-red-950/20 text-red-300";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
}
function supplierStatusClass(s: unknown): string {
  const v = tx(s, "active").toLowerCase();
  if (v === "active") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "suspended") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  return "border-red-500/40 bg-red-950/20 text-red-300";
}
function matchStatusClass(s: unknown): string {
  const v = tx(s, "unmatched").toLowerCase();
  if (v === "matched") return "border-emerald-500/40 bg-emerald-950/20 text-emerald-300";
  if (v === "partial") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  return "border-red-500/40 bg-red-950/20 text-red-300";
}
function priorityClass(p: unknown): string {
  const v = tx(p, "normal").toLowerCase();
  if (v === "emergency") return "border-red-500/60 bg-red-950/30 text-red-300";
  if (v === "urgent") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  if (v === "low") return "border-slate-600/40 bg-slate-900/40 text-slate-500";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
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
    return "The procurement feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Procurement data could not be loaded.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (!rawMessage || /aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  // Business-rule rejections (budget caps, self-approval, stage guards) come
  // through as the backend's own HTTPException detail text, which is written
  // to be user-facing - surface it instead of a generic fallback so the user
  // knows what to actually do (e.g. supply an override reason).
  return rawMessage;
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams?.get("tab");
  const initialTab: Tab =
    requestedTab === "command" || requestedTab === "requisitions" || requestedTab === "rfqs" || requestedTab === "orders" || requestedTab === "suppliers" || requestedTab === "invoices" || requestedTab === "pricing"
      ? (requestedTab === "orders" ? "orders" : requestedTab)
      : "command";

  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Procurement Manager", "Stores and Procurement Manager", "Stores & Procurement Manager", "Procurement Associate", "Project Manager", "Finance Manager", "Site Agent", "Tender / Bid Manager", "Commercial Manager", "Authorising Officer", "Executive Read Only", "External Auditor"]}>
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
      requisitions: () => getProcurementRequisitions({ status: prStatus }),
      rfqs: () => getProcurementRfqs({ status: rfqStatus }),
      orders: () => getProcurementOrders({ status: poStatus }),
      suppliers: () => getProcurementSuppliers(),
      invoices: () => getProcurementInvoices({ match_status: invMatchStatus }),
      projects: () => getInternalProjects(),
      stores: () => getInventoryStores(),
      stockLevels: () => getInventoryStockLevels(),
      movements: () => getStockMovements({ limit: 300 }),
      ccbFindings: () => getCcbFindings({ status: "open" }),
      pendingPricing: () => getMaterialRequests({ is_price_confirmed: false }),
    },
    [prStatus, rfqStatus, poStatus, invMatchStatus],
    {
      criticalKeys: ["requisitions"],
      labels: {
        requisitions: "Requisitions",
        rfqs: "RFQs",
        orders: "Purchase orders",
        suppliers: "Suppliers",
        invoices: "Invoices",
        projects: "Project register",
        stores: "Store register",
        stockLevels: "Stock levels",
        movements: "Stock movements",
        ccbFindings: "CCB findings",
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
      ...requisitions.filter((row) => tx(row.status).toLowerCase() === "submitted").slice(0, 8).map((row) => ({ id: `pr-${row.id}`, tone: "blue" as const, label: "Approve PR", title: tx(row.requisition_number ?? row.pr_number, row.id), meta: `${tx(row.project_name)} · ${money(row.total_estimated)}` })),
      ...rfqs.filter((row) => ["issued", "draft"].includes(tx(row.status).toLowerCase())).slice(0, 8).map((row) => ({ id: `rfq-${row.id}`, tone: "slate" as const, label: "RFQ open", title: tx(row.rfq_number, row.id), meta: tx(row.project_name) })),
      ...overduePOs.slice(0, 8).map((row) => ({ id: `po-${row.id}`, tone: "red" as const, label: "PO overdue", title: tx(row.po_number, row.id), meta: `${tx(row.supplier_name)} · ${dt(row.expected_delivery_date ?? row.required_by_date)}` })),
      ...ccbFindings.slice(0, 8).map((row) => ({ id: `ccb-${row.id}`, tone: "red" as const, label: "CCB", title: tx(row.title ?? row.check_type, row.id), meta: tx(row.project_name ?? row.status) })),
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
      setNotice("Requisition submitted for approval.");
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
      setNotice("Purchase order created from approved requisition.");
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
      setNotice("RFQ issued from approved requisition.");
      setCreatingRfqFromPR(null);
      router.push(TAB_ROUTES.rfqs);
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "RFQ creation failed.")); }
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
      setNotice("Purchase order issued and finance commitment created.");
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
      setNotice("Three-way matching completed.");
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
      setNotice("Invoice payment approved with PO, GRN, invoice and approval evidence linked.");
      await load();
    } catch (e) { setNotice(normalizeActionError(e, "Payment approval failed.")); }
    finally { setSaving(null); }
  };

  const filteredPRs = useMemo(() => {
    const q = query.toLowerCase();
    return requisitions.filter((r) => `${r.pr_number ?? r.reference_number ?? r.id} ${r.project_name ?? ""} ${r.requested_by ?? ""} ${r.status ?? ""}`.toLowerCase().includes(q));
  }, [requisitions, query]);

  const filteredPricing = useMemo(() => {
    const q = query.toLowerCase();
    return pendingPricing.filter((r) => `${r.request_number ?? r.id} ${r.project_name ?? ""} ${r.item_name ?? ""}`.toLowerCase().includes(q));
  }, [pendingPricing, query]);

  const filteredPOs = useMemo(() => {
    const q = query.toLowerCase();
    return orders.filter((r) => `${r.po_number ?? r.reference_number ?? r.id} ${r.supplier_name ?? ""} ${r.project_name ?? ""} ${r.status ?? ""}`.toLowerCase().includes(q));
  }, [orders, query]);

  const filteredRfqs = useMemo(() => {
    const q = query.toLowerCase();
    return rfqs.filter((r) => `${r.rfq_number ?? r.id} ${r.requisition_number ?? ""} ${r.project_name ?? ""} ${r.status ?? ""}`.toLowerCase().includes(q));
  }, [rfqs, query]);

  const filteredSuppliers = useMemo(() => {
    const q = query.toLowerCase();
    return suppliers.filter((r) => `${r.name ?? r.supplier_name ?? ""} ${r.code ?? r.supplier_code ?? ""} ${r.praz_number ?? ""}`.toLowerCase().includes(q));
  }, [suppliers, query]);

  const filteredInvoices = useMemo(() => {
    const q = query.toLowerCase();
    return invoices.filter((r) => `${r.invoice_number ?? r.id} ${r.supplier_name ?? ""} ${r.po_number ?? ""} ${r.match_status ?? ""}`.toLowerCase().includes(q));
  }, [invoices, query]);

  const unmatchedCount = useMemo(
    () => filteredInvoices.filter((r) => ["unmatched", "disputed"].includes(tx(r.match_status ?? r.matching_status).toLowerCase())).length,
    [filteredInvoices]
  );

  return (
    <main className="min-h-full bg-ink p-4 text-paper sm:p-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-mid pb-5">
        <div>
          <p className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-signal">
            <ClipboardList className="h-4 w-4" />Procurement Control Tower
          </p>
          <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Procurement Pipeline</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-light">
            Procurement and inventory command view — what is in store, what moved, what is coming, and what needs action.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "suppliers" ? (
            <button onClick={() => setShowAddSupplier(true)} className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90">
              <Plus className="h-4 w-4" />New Supplier
            </button>
          ) : (
            <button onClick={() => setShowCreatePR(true)} className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90">
              <Plus className="h-4 w-4" />New Requisition
            </button>
          )}
          <button onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 border border-ink-mid bg-ink-light px-3 font-mono text-xs uppercase tracking-wider text-slate-light hover:border-signal hover:text-paper disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
          </button>
        </div>
      </header>

      {/* KPI Strip */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <KpiCard icon={<FileText />} label="Open PRs" value={loading ? "…" : String(kpis.openPRs)} />
        <KpiCard icon={<Send />} label="Awaiting Approval" value={String(kpis.awaitingApproval)} tone={kpis.awaitingApproval ? "text-blue-300" : undefined} />
        <KpiCard icon={<Search />} label="Active RFQs" value={String(kpis.activeRFQs)} />
        <KpiCard icon={<Package />} label="Open POs" value={String(kpis.activePOs)} tone="text-purple-300" />
        <KpiCard icon={<PackageCheck />} label="GRNs Pending" value={String(kpis.grnsPending)} tone={kpis.grnsPending ? "text-amber-300" : undefined} />
        <KpiCard icon={<AlertTriangle />} label="Invoices Pending" value={String(kpis.invPending)} tone={kpis.invPending ? "text-amber-300" : undefined} />
        <KpiCard icon={<DollarSign />} label="Total Committed" value={loading ? "…" : money(kpis.committed)} tone="text-signal" large />
      </section>

      {/* Alerts */}
      {error && <Banner tone="error" message={error} />}
      {sourceWarnings.length > 0 && <div className="mb-6 space-y-2">{sourceWarnings.map((warning) => <Banner key={warning} tone="info" message={warning} />)}</div>}
      {notice && <Banner tone="info" message={notice} onClose={() => setNotice(null)} />}

      {/* Module bar */}
      <div className="flex border-b border-ink-mid">
        {(["command", "requisitions", "rfqs", "orders", "suppliers", "invoices", "pricing"] as Tab[]).map((item) => {
          const isCurrent = tab === item;
          const label =
            item === "command" ? "Command" :
            item === "requisitions" ? "Requisitions" :
            item === "rfqs" ? "RFQs" :
            item === "orders" ? "Purchase Orders" :
            item === "suppliers" ? "Suppliers" :
            item === "pricing" ? "Pending Pricing" :
            "Invoices";
          return (
            <Link
              key={item}
              href={TAB_ROUTES[item]}
              onClick={() => setQuery("")}
              className={`px-5 py-3 font-mono text-xs font-bold uppercase tracking-widest transition-colors ${isCurrent ? "border-b-2 border-signal text-signal" : "text-slate hover:text-paper"}`}
            >
              {item === "invoices" ? (
                <span className="flex items-center gap-1.5">
                  {label}
                  {unmatchedCount > 0 && !loading && <span className="rounded-full bg-red-600 px-1.5 py-0.5 font-mono text-[10px] text-white">{unmatchedCount}</span>}
                </span>
              ) : item === "pricing" ? (
                <span className="flex items-center gap-1.5">
                  {label}
                  {pendingPricing.length > 0 && !loading && <span className="rounded-full bg-amber-600 px-1.5 py-0.5 font-mono text-[10px] text-white">{pendingPricing.length}</span>}
                </span>
              ) : label}
            </Link>
          );
        })}
      </div>

      {/* Filter bar */}
      {tab !== "command" && <div className="flex flex-col gap-2 border-b border-ink-mid bg-ink-light/30 p-3 sm:flex-row sm:items-center">
        <label className="flex flex-1 h-9 items-center gap-2 border border-ink-mid bg-ink px-3">
          <Search className="h-3.5 w-3.5 text-slate" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab}…`} className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate" />
        </label>
        {tab === "requisitions" && (
          <select value={prStatus} onChange={(e) => setPrStatus(e.target.value)} className="h-9 border border-ink-mid bg-ink px-3 text-sm text-paper">
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="ordered">Ordered</option>
          </select>
        )}
        {tab === "rfqs" && (
          <select value={rfqStatus} onChange={(e) => setRfqStatus(e.target.value)} className="h-9 border border-ink-mid bg-ink px-3 text-sm text-paper">
            <option value="all">All RFQ statuses</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
        {tab === "orders" && (
          <select value={poStatus} onChange={(e) => setPoStatus(e.target.value)} className="h-9 border border-ink-mid bg-ink px-3 text-sm text-paper">
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="issued">Issued</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
        {tab === "invoices" && (
          <select value={invMatchStatus} onChange={(e) => setInvMatchStatus(e.target.value)} className="h-9 border border-ink-mid bg-ink px-3 text-sm text-paper">
            <option value="all">All match statuses</option>
            <option value="matched">Matched</option>
            <option value="partial">Partial</option>
            <option value="unmatched">Unmatched</option>
            <option value="disputed">Disputed</option>
          </select>
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
          <InvoicesTab rows={filteredInvoices} unmatchedCount={unmatchedCount} saving={saving} onMatch={matchInvoice} onApprovePayment={setPaymentEvidenceInvoice} />
        }
      </section>

      {/* Modals */}
      {showCreatePR && <CreatePRModal projects={projects} onClose={() => setShowCreatePR(false)} onCreated={() => { setShowCreatePR(false); setNotice("Purchase requisition created."); void load(); }} />}
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

// ─── Procurement Manager Command Dashboard ───────────────────────────────────

function ProcurementCommandDashboard({ command, loading }: { command: any; loading: boolean }) {
  if (loading && !command) return <LoadingState label="Loading command dashboard…" />;
  return (
    <div className="space-y-5 p-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard icon={<Warehouse />} label="Stock Value" value={money(command.stockValueTotal)} tone="text-signal" />
        <KpiCard icon={<Package />} label="Materials" value={money(command.materialsValue)} />
        <KpiCard icon={<Truck />} label="Tools" value={money(command.toolsValue)} />
        <KpiCard icon={<AlertTriangle />} label="Low Stock" value={String(command.lowStock.length)} tone={command.lowStock.length ? "text-amber-300" : undefined} />
        <KpiCard icon={<XCircle />} label="Out of Stock" value={String(command.outOfStock.length)} tone={command.outOfStock.length ? "text-red-300" : undefined} />
        <KpiCard icon={<ShoppingCart />} label="Incoming PO Value" value={money(command.incomingValue)} tone="text-purple-300" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1.2fr_.9fr]">
        <CommandPanel title="Stores and Stock Position" icon={<MapPin />}>
          <div className="space-y-2">
            {command.storeSummaries.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-light">No stores registered yet.</p>
            ) : command.storeSummaries.slice(0, 10).map((store: Rec) => (
              <div key={store.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-ink-mid/70 pb-2">
                <div>
                  <p className="text-sm font-semibold text-paper">{tx(store.name ?? store.store_name)}</p>
                  <p className="mt-0.5 text-xs text-slate-light">{tx(store.project_name ?? store.client_name ?? store.store_type, "Company store")}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-paper">{money(store.value)}</p>
                  <p className="font-mono text-[10px] uppercase text-slate">{num(store.itemCount)} items</p>
                </div>
              </div>
            ))}
          </div>
        </CommandPanel>

        <CommandPanel title="Live Movement Feed" icon={<PackageCheck />}>
          <div className="mb-3 grid grid-cols-4 gap-2">
            <MiniMetric label="Added" value={String(command.additions.length)} tone="text-emerald-300" />
            <MiniMetric label="Reduced" value={String(command.subtractions.length)} tone="text-blue-300" />
            <MiniMetric label="Transfers" value={String(command.transfers.length)} tone="text-purple-300" />
            <MiniMetric label="Adjust" value={String(command.adjustments.length)} tone="text-amber-300" />
          </div>
          <div className="max-h-80 space-y-2 overflow-auto">
            {command.recentMovements.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-light">No stock movements recorded.</p>
            ) : command.recentMovements.map((movement: Rec) => {
              const quantity = num(movement.quantity);
              const isAdd = quantity > 0;
              return (
                <div key={movement.id} className="flex items-start justify-between gap-3 border-b border-ink-mid/70 pb-2">
                  <div>
                    <p className="text-sm text-paper">{tx(movement.item_name ?? movement.item_code)}</p>
                    <p className="mt-0.5 text-xs text-slate-light">{tx(movement.movement_type)} · {tx(movement.store_name)} · {tx(movement.project_name, "No project")}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-sm font-semibold ${isAdd ? "text-emerald-300" : "text-blue-300"}`}>{isAdd ? "+" : ""}{qty(quantity)}</p>
                    <p className="font-mono text-[10px] text-slate">{dt(movement.movement_at ?? movement.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CommandPanel>

        <CommandPanel title="Action and Risk Queue" icon={<ShieldAlert />}>
          <div className="space-y-2">
            {command.actionQueue.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-light">No urgent procurement or inventory actions.</p>
            ) : command.actionQueue.map((item: { id: string; tone: "amber" | "blue" | "red" | "slate"; label: string; title: string; meta: string }) => (
              <div key={item.id} className="border border-ink-mid/70 p-3">
                <span className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase ${queueToneClass(item.tone)}`}>{item.label}</span>
                <p className="mt-2 text-sm font-semibold text-paper">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-light">{item.meta}</p>
              </div>
            ))}
          </div>
        </CommandPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <CommandPanel title="Incoming Purchase Orders" icon={<ShoppingCart />}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-left">
                  {["PO", "Supplier", "Project", "Status", "Remaining Value", "Expected"].map((h) => <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/70">
                {command.incomingPOs.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-light">No issued or partially received POs waiting for delivery.</td></tr>
                ) : command.incomingPOs.slice(0, 10).map((po: Rec) => {
                  const pctReceived = Math.min(100, Math.max(0, num(po.percent_received ?? 0)));
                  const remaining = num(po.total_amount ?? po.amount) * (1 - pctReceived / 100);
                  return (
                    <tr key={po.id}>
                      <td className="px-3 py-2 font-mono text-xs text-signal">{tx(po.po_number, po.id)}</td>
                      <td className="px-3 py-2 text-paper">{tx(po.supplier_name)}</td>
                      <td className="px-3 py-2 text-slate-light">{tx(po.project_name)}</td>
                      <td className="px-3 py-2"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(po.status)}`}>{tx(po.status)}</span></td>
                      <td className="px-3 py-2 font-mono text-paper">{money(remaining)}</td>
                      <td className="px-3 py-2 text-slate-light">{dt(po.expected_delivery_date ?? po.required_by_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CommandPanel>

        <CommandPanel title="Stock Exceptions" icon={<AlertTriangle />}>
          <div className="grid gap-3 md:grid-cols-2">
            <ExceptionList title="Below reorder" rows={command.lowStock.slice(0, 8)} tone="amber" />
            <ExceptionList title="Out of stock" rows={command.outOfStock.slice(0, 8)} tone="red" />
          </div>
        </CommandPanel>
      </section>
    </div>
  );
}

function CommandPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-ink-mid bg-ink p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-paper">{title}</h2>
        <span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      </div>
      {children}
    </section>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="border border-ink-mid bg-ink-light/30 p-2 text-center">
      <p className={`font-mono text-lg font-semibold ${tone}`}>{value}</p>
      <p className="font-mono text-[9px] uppercase text-slate">{label}</p>
    </div>
  );
}

function queueToneClass(tone: "amber" | "blue" | "red" | "slate") {
  if (tone === "amber") return "border-amber-500/40 bg-amber-950/20 text-amber-300";
  if (tone === "blue") return "border-blue-500/40 bg-blue-950/20 text-blue-300";
  if (tone === "red") return "border-red-500/40 bg-red-950/20 text-red-300";
  return "border-slate-500/40 bg-slate-800/40 text-slate-400";
}

function ExceptionList({ title, rows, tone }: { title: string; rows: Rec[]; tone: "amber" | "red" }) {
  return (
    <div className="border border-ink-mid/70 p-3">
      <h3 className={`mb-2 font-mono text-[10px] uppercase tracking-wider ${tone === "red" ? "text-red-300" : "text-amber-300"}`}>{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-slate-light">Clear.</p> : rows.map((row) => (
        <div key={`${row.item_id ?? row.id}-${row.store_id ?? row.store_name}`} className="border-b border-ink-mid/60 py-2 last:border-0">
          <p className="text-sm text-paper">{tx(row.item_name ?? row.item_code)}</p>
          <p className="text-xs text-slate-light">{tx(row.store_name, "No store")} · available {qty(row.available_qty ?? row.quantity ?? row.stock_quantity)}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Requisitions Table ───────────────────────────────────────────────────────

function RequisitionsTable({ rows, saving, onSubmit, onApprove, onCreateRFQ, onCreatePO }: { rows: Rec[]; saving: string | null; onSubmit: (id: string) => void; onApprove: (row: Rec) => void; onCreateRFQ: (row: Rec) => void; onCreatePO: (row: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No purchase requisitions match this view." sub="Create the first requisition using the button above." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["PR Number", "Project", "Priority", "Status", "Requested By", "Est. Total", "Required By", "Actions"].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const status = tx(row.status, "draft").toLowerCase();
            const isDraft = status === "draft" || status === "rejected";
            const isSubmitted = status === "submitted";
            const isApproved = status === "approved";
            return (
              <tr key={row.id} className="hover:bg-ink-light/40">
                <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.pr_number ?? row.reference_number, row.id.slice(0, 8).toUpperCase())}</td>
                <td className="px-4 py-3 text-paper">{tx(row.project_name ?? row.project)}</td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${priorityClass(row.priority)}`}>{tx(row.priority, "normal")}</span></td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(row.status)}`}>{tx(row.status, "draft")}</span></td>
                <td className="px-4 py-3 text-slate-light">{tx(row.requested_by ?? row.created_by_name)}</td>
                <td className="px-4 py-3 font-mono text-paper">{money(row.total_estimated ?? row.estimated_total ?? 0)}</td>
                <td className="px-4 py-3 text-slate-light">{dt(row.required_by_date ?? row.required_by)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {isDraft && (
                      <button onClick={() => onSubmit(row.id)} disabled={saving === `submit-${row.id}`}
                        className="inline-flex items-center gap-1 border border-blue-500/40 px-2 py-1 font-mono text-[10px] uppercase text-blue-300 hover:bg-blue-950/30 disabled:opacity-40">
                        <Send className="h-3 w-3" />Submit
                      </button>
                    )}
                    {isSubmitted && (
                      <button onClick={() => onApprove(row)}
                        className="inline-flex items-center gap-1 border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30">
                        <BadgeCheck className="h-3 w-3" />Decide
                      </button>
                    )}
                    {isApproved && (
                      <>
                        <button onClick={() => onCreateRFQ(row)} disabled={saving === `rfq-${row.id}`}
                          className="inline-flex items-center gap-1 border border-blue-500/40 px-2 py-1 font-mono text-[10px] uppercase text-blue-300 hover:bg-blue-950/30 disabled:opacity-40">
                          <Search className="h-3 w-3" />RFQ
                        </button>
                        <button onClick={() => onCreatePO(row)} disabled={saving === `po-${row.id}`}
                          className="inline-flex items-center gap-1 border border-signal/40 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/10 disabled:opacity-40">
                          <ShoppingCart className="h-3 w-3" />Direct PO
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pending Pricing Tab ────────────────────────────────────────────────────

function PendingPricingTable({ rows, saving, onConfirm }: { rows: Rec[]; saving: string | null; onConfirm: (id: string, unitCost: number) => void; }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (rows.length === 0) return <EmptyState label="No material requests are waiting on pricing." sub="Site material requests submitted with no known price appear here until procurement or inventory confirms the real cost." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["Request", "Project", "Item", "Qty", "Issued", "Required By", "Confirm Unit Cost"].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const draft = drafts[row.id] ?? "";
            const busy = saving === `price-${row.id}`;
            const parsed = Number(draft);
            const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
            return (
              <tr key={row.id} className="hover:bg-ink-light/40">
                <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.request_number, row.id.slice(0, 8).toUpperCase())}</td>
                <td className="px-4 py-3 text-paper">{tx(row.project_name)}</td>
                <td className="px-4 py-3 text-paper">{tx(row.item_name ?? row.item_code)}</td>
                <td className="px-4 py-3 text-slate-light">{tx(String(row.requested_quantity ?? ""))} {tx(row.unit_of_measure, "")}</td>
                <td className="px-4 py-3 text-slate-light">{tx(String(row.issued_quantity ?? "0"))}</td>
                <td className="px-4 py-3 text-slate-light">{dt(row.required_by_date)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      type="number" min="0" step="0.0001" placeholder="Unit cost ($)"
                      className="h-8 w-28 border border-ink-mid bg-ink px-2 text-xs text-paper"
                    />
                    <button
                      onClick={() => onConfirm(row.id, parsed)}
                      disabled={!valid || busy}
                      className="inline-flex items-center gap-1 border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40"
                    >
                      <BadgeCheck className="h-3 w-3" />Confirm
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── RFQs Tab ────────────────────────────────────────────────────────────────

function RfqsTab({ rows, saving, onQuote, onDecideQuote, onCreatePO }: { rows: Rec[]; saving: string | null; onQuote: (row: Rec) => void; onDecideQuote: (rfq: Rec, response: Rec, decision: "selected" | "rejected" | "evaluated") => void; onCreatePO: (response: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No RFQs match this view." sub="Create RFQs from approved purchase requisitions." />;
  return (
    <div className="divide-y divide-ink-mid">
      {rows.map((rfq) => {
        const responses: Rec[] = Array.isArray(rfq.responses) ? rfq.responses : [];
        const selected = responses.find((r) => tx(r.status).toLowerCase() === "selected");
        return (
          <article key={rfq.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-signal">{tx(rfq.rfq_number, rfq.id.slice(0, 8).toUpperCase())}</p>
                <h3 className="mt-1 text-lg font-semibold text-paper">{tx(rfq.title, tx(rfq.requisition_number, "RFQ"))}</h3>
                <p className="mt-1 text-xs text-slate-light">{tx(rfq.project_name)} · PR {tx(rfq.requisition_number)} · closes {dt(rfq.closing_date)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(rfq.status)}`}>{tx(rfq.status, "draft")}</span>
                <button onClick={() => onQuote(rfq)} className="inline-flex items-center gap-1 border border-blue-500/40 px-2 py-1 font-mono text-[10px] uppercase text-blue-300 hover:bg-blue-950/30">
                  <Plus className="h-3 w-3" />Quote
                </button>
                {selected && (
                  <button onClick={() => onCreatePO(selected)} disabled={saving === `po-rfq-${selected.id}`}
                    className="inline-flex items-center gap-1 border border-signal/40 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/10 disabled:opacity-40">
                    <ShoppingCart className="h-3 w-3" />Create PO
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-ink-mid text-left">
                    {["Supplier", "Reference", "Amount", "Delivery", "Score", "Status", "Actions"].map((h) => <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid/70">
                  {responses.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-4 text-sm text-slate-light">No supplier quotations captured yet.</td></tr>
                  ) : responses.map((response) => {
                    const responseStatus = tx(response.status, "received").toLowerCase();
                    return (
                      <tr key={response.id}>
                        <td className="px-3 py-2 text-paper">{tx(response.supplier_name)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-light">{tx(response.reference)}</td>
                        <td className="px-3 py-2 font-mono text-paper">{money(response.total_amount)}</td>
                        <td className="px-3 py-2 text-slate-light">{response.delivery_days ? `${response.delivery_days} days` : "—"}</td>
                        <td className="px-3 py-2 font-mono text-slate-light">{response.evaluation_score ?? "—"}</td>
                        <td className="px-3 py-2"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${supplierStatusClass(response.status)}`}>{tx(response.status)}</span></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {responseStatus !== "selected" && (
                              <button onClick={() => onDecideQuote(rfq, response, "selected")} disabled={saving === `quote-decision-${response.id}`}
                                className="border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40">Select</button>
                            )}
                            {responseStatus === "selected" && (
                              <button onClick={() => onCreatePO(response)} disabled={saving === `po-rfq-${response.id}`}
                                className="border border-signal/40 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/10 disabled:opacity-40">PO</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ─── Orders Table ─────────────────────────────────────────────────────────────

function OrdersTable({ rows, onView }: { rows: Rec[]; onView: (row: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No purchase orders match this view." sub="Orders are created from approved requisitions." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["PO Number", "Supplier", "Project", "Total Amount", "Status", "Issued", "Exp. Delivery", "% Received", ""].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const received = num(row.percent_received ?? row.qty_received_pct ?? 0);
            return (
              <tr key={row.id} className="hover:bg-ink-light/40">
                <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.po_number ?? row.reference_number, row.id.slice(0, 8).toUpperCase())}</td>
                <td className="px-4 py-3 text-paper">{tx(row.supplier_name)}</td>
                <td className="px-4 py-3 text-slate-light">{tx(row.project_name ?? row.project)}</td>
                <td className="px-4 py-3 font-mono text-paper">{money(row.total_amount ?? row.amount ?? 0)}</td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(row.status)}`}>{tx(row.status, "draft")}</span></td>
                <td className="px-4 py-3 text-slate-light">{dt(row.issued_date ?? row.created_at)}</td>
                <td className="px-4 py-3 text-slate-light">{dt(row.expected_delivery_date ?? row.expected_delivery)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-mid">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(received, 100)}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-slate-light">{pct(received)}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => onView(row)} className="inline-flex items-center gap-1 border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
                    <ArrowRight className="h-3 w-3" />View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Suppliers Table ──────────────────────────────────────────────────────────

function SuppliersTable({ rows, onView }: { rows: Rec[]; onView: (row: Rec) => void; }) {
  if (rows.length === 0) return <EmptyState label="No suppliers registered." sub="Use New Supplier above to register one, or wait for supplier portal self-registrations." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
            {["Supplier Name", "Code", "Status", "PRAZ Number", "Performance", "On-Time %", "Open POs", "Outstanding Balance"].map((h) => (
              <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {rows.map((row) => {
            const score = num(row.performance_score ?? row.rating ?? 0);
            const stars = Math.round(Math.min(score, 5));
            const otd = num(row.on_time_delivery_pct);
            return (
              <tr key={row.id} onClick={() => onView(row)} className="cursor-pointer hover:bg-ink-light/40" title="Open Supplier 360">
                <td className="px-4 py-3 font-semibold text-paper">{tx(row.name ?? row.supplier_name)}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.code ?? row.supplier_code)}</td>
                <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${supplierStatusClass(row.status)}`}>{tx(row.status, "active")}</span></td>
                <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.praz_number ?? row.registration_number)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`h-3 w-3 ${i < stars ? "fill-signal text-signal" : "text-slate"}`} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`font-mono text-xs ${row.on_time_delivery_pct != null ? (otd >= 90 ? "text-emerald-300" : otd >= 70 ? "text-amber-300" : "text-red-300") : "text-slate"}`}>
                    {row.on_time_delivery_pct != null ? pct(otd) : "—"}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-paper">{num(row.outstanding_pos ?? 0)}</td>
                <td className="px-4 py-3 font-mono text-xs text-paper">{money(row.outstanding_balance ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SUPPLIER_STATUSES = ["active", "pending_approval", "suspended", "blacklisted"] as const;
const SUPPLIER_COMPLIANCE_STATUSES = ["pending", "compliant", "non_compliant", "exempt"] as const;
type SupplierModalTab = "overview" | "dealings";

function supplierEditDraft(supplier: Rec) {
  return {
    supplier_name: tx(supplier.supplier_name ?? supplier.name, ""),
    supplier_code: tx(supplier.supplier_code ?? supplier.code, ""),
    trading_name: tx(supplier.trading_name, ""),
    registration_number: tx(supplier.registration_number, ""),
    tax_number: tx(supplier.tax_number, ""),
    praz_number: tx(supplier.praz_number, ""),
    nssa_number: tx(supplier.nssa_number, ""),
    primary_contact_name: tx(supplier.primary_contact_name, ""),
    primary_contact_email: tx(supplier.primary_contact_email, ""),
    primary_contact_phone: tx(supplier.primary_contact_phone, ""),
    payment_terms_days: String(supplier.payment_terms_days ?? 30),
    currency: tx(supplier.currency, "USD"),
    status: tx(supplier.status, "pending_approval"),
    compliance_status: tx(supplier.compliance_status, "pending"),
    performance_score: supplier.performance_score == null ? "" : String(supplier.performance_score),
    on_time_delivery_pct: supplier.on_time_delivery_pct == null ? "" : String(supplier.on_time_delivery_pct),
  };
}

function Supplier360Modal({
  supplier,
  onClose,
  onSaved,
  onCredentials,
}: {
  supplier: Rec;
  onClose: () => void;
  onSaved: (supplier: Rec) => void;
  onCredentials: (credentials: { email: string; temporary_password: string }) => void;
}) {
  const [items, setItems] = useState<Rec[]>([]);
  const [orders, setOrders] = useState<Rec[]>([]);
  const [invoices, setInvoices] = useState<Rec[]>([]);
  const [quotes, setQuotes] = useState<Rec[]>([]);
  const [form, setForm] = useState(() => supplierEditDraft(supplier));
  const [activeTab, setActiveTab] = useState<SupplierModalTab>("overview");
  const [loading, setLoading] = useState(true);
  const [dealingsLoading, setDealingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuingLogin, setIssuingLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealingsError, setDealingsError] = useState<string | null>(null);
  const [copiedPortalCard, setCopiedPortalCard] = useState(false);
  const portalUrl = typeof window !== "undefined" ? `${window.location.origin}/portal/supplier` : "/portal/supplier";

  useEffect(() => {
    let cancelled = false;
    setForm(supplierEditDraft(supplier));
    setLoading(true);
    setDealingsLoading(true);
    setError(null);
    setDealingsError(null);
    getSupplierCatalogue(supplier.id)
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.data)) setItems(res.data);
        else setError("Catalogue could not be loaded.");
      })
      .catch(() => { if (!cancelled) setError("Catalogue could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    Promise.allSettled([
      getProcurementOrders({ supplier_id: supplier.id }),
      getProcurementInvoices(),
      getProcurementRfqs(),
    ])
      .then(([ordersRes, invoicesRes, rfqsRes]) => {
        if (cancelled) return;
        if (ordersRes.status === "fulfilled" && Array.isArray(ordersRes.value.data)) setOrders(ordersRes.value.data);
        else setDealingsError("Some supplier dealings could not be loaded.");

        if (invoicesRes.status === "fulfilled" && Array.isArray(invoicesRes.value.data)) {
          setInvoices(invoicesRes.value.data.filter((invoice) => invoice.supplier_id === supplier.id || tx(invoice.supplier_name, "").toLowerCase() === tx(supplier.supplier_name ?? supplier.name, "").toLowerCase()));
        } else {
          setDealingsError("Some supplier dealings could not be loaded.");
        }

        if (rfqsRes.status === "fulfilled" && Array.isArray(rfqsRes.value.data)) {
          const supplierQuotes = rfqsRes.value.data.flatMap((rfq) => {
            const responses = Array.isArray(rfq.responses) ? rfq.responses : [];
            return responses
              .filter((response: Rec) => response.supplier_id === supplier.id || tx(response.supplier_name, "").toLowerCase() === tx(supplier.supplier_name ?? supplier.name, "").toLowerCase())
              .map((response: Rec) => ({
                ...response,
                rfq_number: rfq.rfq_number,
                rfq_title: rfq.title,
                closing_date: rfq.closing_date,
              }));
          });
          setQuotes(supplierQuotes);
        } else {
          setDealingsError("Some supplier dealings could not be loaded.");
        }
      })
      .catch(() => { if (!cancelled) setDealingsError("Supplier dealings could not be loaded."); })
      .finally(() => { if (!cancelled) setDealingsLoading(false); });
    return () => { cancelled = true; };
  }, [supplier]);

  const updateField = (field: keyof ReturnType<typeof supplierEditDraft>, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    if (!form.supplier_name.trim()) { setError("Supplier name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        supplier_name: form.supplier_name.trim(),
        supplier_code: form.supplier_code.trim() || null,
        trading_name: form.trading_name.trim() || null,
        registration_number: form.registration_number.trim() || null,
        tax_number: form.tax_number.trim() || null,
        praz_number: form.praz_number.trim() || null,
        nssa_number: form.nssa_number.trim() || null,
        primary_contact_name: form.primary_contact_name.trim() || null,
        primary_contact_email: form.primary_contact_email.trim() || null,
        primary_contact_phone: form.primary_contact_phone.trim() || null,
        payment_terms_days: Number(form.payment_terms_days || 30),
        currency: form.currency.trim() || "USD",
        status: form.status,
        compliance_status: form.compliance_status,
        performance_score: form.performance_score === "" ? null : Number(form.performance_score),
        on_time_delivery_pct: form.on_time_delivery_pct === "" ? null : Number(form.on_time_delivery_pct),
      };
      await updateSupplierRecord(supplier.id, payload);
      onSaved({ ...supplier, ...payload });
    } catch (e) {
      setError(normalizeActionError(e, "Supplier could not be updated."));
    } finally {
      setSaving(false);
    }
  };

  const issueLogin = async () => {
    if (!form.primary_contact_email.trim()) {
      setError("Add and save a primary contact email before issuing login details.");
      return;
    }
    setIssuingLogin(true);
    setError(null);
    try {
      const res = await issueSupplierPortalLogin(supplier.id);
      if (!res.success || !res.data?.temporary_password) throw new Error("No password returned.");
      onCredentials({ email: res.data.email, temporary_password: res.data.temporary_password });
    } catch (e) {
      setError(normalizeActionError(e, "Supplier portal login could not be issued."));
    } finally {
      setIssuingLogin(false);
    }
  };

  const copyPortalCard = async () => {
    const card = [
      `Supplier portal: ${portalUrl}`,
      `Supplier: ${form.supplier_name}`,
      `Email: ${form.primary_contact_email || "Add contact email first"}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(card);
      setCopiedPortalCard(true);
      window.setTimeout(() => setCopiedPortalCard(false), 1800);
    } catch {
      setError("Could not copy portal details.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-6xl border border-ink-mid bg-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Supplier 360</p>
            <h2 className="mt-1 text-lg font-semibold text-paper">{tx(form.supplier_name)}</h2>
            <p className="mt-1 text-xs text-slate-light">Profile, compliance status, portal access and receipt-backed catalogue in one place.</p>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex border-b border-ink-mid bg-ink-light/40">
          {([
            ["overview", "360 view"],
            ["dealings", "Business dealings"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`h-11 border-r border-ink-mid px-4 font-mono text-[10px] font-bold uppercase tracking-wider ${activeTab === id ? "bg-signal text-ink" : "text-slate-light hover:bg-ink-light hover:text-paper"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="max-h-[76vh] overflow-y-auto p-4">
          {error && <div className="mb-4"><Banner tone="error" message={error} /></div>}
          {activeTab === "overview" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <section className="space-y-4">
              <div className="border border-ink-mid bg-ink-light/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-ink-mid pb-3">
                  <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Company and compliance</h3>
                  <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${supplierStatusClass(form.status)}`}>{form.status}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <SupplierField label="Supplier name" value={form.supplier_name} onChange={(v) => updateField("supplier_name", v)} required />
                  <SupplierField label="Supplier code" value={form.supplier_code} onChange={(v) => updateField("supplier_code", v)} />
                  <SupplierField label="Trading name" value={form.trading_name} onChange={(v) => updateField("trading_name", v)} />
                  <SupplierField label="Registration number" value={form.registration_number} onChange={(v) => updateField("registration_number", v)} />
                  <SupplierField label="Tax clearance number" value={form.tax_number} onChange={(v) => updateField("tax_number", v)} />
                  <SupplierField label="PRAZ number" value={form.praz_number} onChange={(v) => updateField("praz_number", v)} />
                  <SupplierField label="NSSA number" value={form.nssa_number} onChange={(v) => updateField("nssa_number", v)} />
                  <SupplierField label="Currency" value={form.currency} onChange={(v) => updateField("currency", v.toUpperCase().slice(0, 3))} />
                  <SupplierSelect label="Supplier status" value={form.status} options={SUPPLIER_STATUSES} onChange={(v) => updateField("status", v)} />
                  <SupplierSelect label="Compliance status" value={form.compliance_status} options={SUPPLIER_COMPLIANCE_STATUSES} onChange={(v) => updateField("compliance_status", v)} />
                  <SupplierField label="Payment terms days" type="number" value={form.payment_terms_days} onChange={(v) => updateField("payment_terms_days", v)} />
                  <SupplierField label="Performance score" type="number" value={form.performance_score} onChange={(v) => updateField("performance_score", v)} />
                  <SupplierField label="On-time delivery %" type="number" value={form.on_time_delivery_pct} onChange={(v) => updateField("on_time_delivery_pct", v)} />
                </div>
              </div>

              <div className="border border-ink-mid bg-ink-light/40 p-4">
                <h3 className="mb-3 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper">Primary contact</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <SupplierField label="Contact name" value={form.primary_contact_name} onChange={(v) => updateField("primary_contact_name", v)} />
                  <SupplierField label="Contact phone" value={form.primary_contact_phone} onChange={(v) => updateField("primary_contact_phone", v)} />
                  <div className="md:col-span-2">
                    <SupplierField label="Contact email" type="email" value={form.primary_contact_email} onChange={(v) => updateField("primary_contact_email", v)} />
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="border border-signal/30 bg-signal/5 p-4">
                <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-paper">Supplier portal access</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-light">Issue or reset login details for the supplier contact. The password is shown once so it can be copied and shared directly.</p>
                <div className="mt-3 space-y-2 border border-ink-mid bg-ink p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Portal link</p>
                  <p className="break-all font-mono text-xs text-paper">{portalUrl}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Login email</p>
                  <p className="break-all font-mono text-xs text-paper">{form.primary_contact_email || "Add contact email first"}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => void copyPortalCard()} className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-[10px] uppercase text-slate-light hover:border-signal hover:text-paper">
                    <ClipboardList className="h-3.5 w-3.5" />{copiedPortalCard ? "Copied" : "Copy details"}
                  </button>
                  <button onClick={() => void issueLogin()} disabled={issuingLogin || !form.primary_contact_email.trim()} className="inline-flex h-9 items-center gap-2 bg-signal px-3 font-mono text-[10px] font-bold uppercase text-ink disabled:opacity-50">
                    {issuingLogin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Issue login
                  </button>
                </div>
              </div>
            </section>
          </div>
          ) : (
            <SupplierBusinessDealings
              items={items}
              loading={loading || dealingsLoading}
              error={dealingsError}
              orders={orders}
              invoices={invoices}
              quotes={quotes}
            />
          )}
        </div>
        <footer className="flex justify-end gap-3 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Close</button>
          {activeTab === "overview" && (
            <button onClick={() => void save()} disabled={saving} className="inline-flex h-10 items-center gap-2 bg-signal px-5 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save supplier
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function SupplierBusinessDealings({
  items,
  loading,
  error,
  orders,
  invoices,
  quotes,
}: {
  items: Rec[];
  loading: boolean;
  error: string | null;
  orders: Rec[];
  invoices: Rec[];
  quotes: Rec[];
}) {
  const poTotal = orders.reduce((sum, row) => sum + num(row.total_amount ?? row.amount ?? 0), 0);
  const invoiceTotal = invoices.reduce((sum, row) => sum + num(row.total_amount ?? row.amount ?? 0), 0);
  const receivedValue = items.reduce((sum, row) => sum + (num(row.total_quantity_received) * num(row.last_unit_cost ?? 0)), 0);
  const selectedQuotes = quotes.filter((row) => tx(row.status, "").toLowerCase() === "selected").length;

  if (loading) return <LoadingState label="Loading supplier dealings..." />;

  return (
    <div className="space-y-4">
      {error && <Banner tone="info" message={error} />}
      <div className="grid gap-3 md:grid-cols-4">
        <SupplierDealMetric label="Purchase orders" value={String(orders.length)} detail={money(poTotal)} />
        <SupplierDealMetric label="Invoices" value={String(invoices.length)} detail={money(invoiceTotal)} />
        <SupplierDealMetric label="Quoted RFQs" value={String(quotes.length)} detail={`${selectedQuotes} selected`} />
        <SupplierDealMetric label="Received catalogue" value={String(items.length)} detail={money(receivedValue)} />
      </div>

      <SupplierDealTable
        title="Purchase orders"
        empty="No purchase orders with this supplier yet."
        headers={["PO", "Project", "Status", "Total", "Issued", "Expected"]}
        rows={orders.map((row) => [
          tx(row.po_number ?? row.reference_number, row.id?.slice(0, 8)),
          tx(row.project_name ?? row.project),
          tx(row.status),
          money(row.total_amount ?? row.amount ?? 0),
          dt(row.issued_at ?? row.created_at),
          dt(row.expected_delivery_date ?? row.required_by_date),
        ])}
      />

      <SupplierDealTable
        title="Supplier invoices"
        empty="No supplier invoices captured for this supplier yet."
        headers={["Invoice", "Supplier ref", "PO", "Date", "Total", "Match", "Status"]}
        rows={invoices.map((row) => [
          tx(row.invoice_number ?? row.reference_number, row.id?.slice(0, 8)),
          tx(row.supplier_invoice_ref ?? row.external_reference),
          tx(row.po_number),
          dt(row.invoice_date ?? row.created_at),
          money(row.total_amount ?? row.amount ?? 0),
          tx(row.match_status ?? row.matching_status),
          tx(row.status),
        ])}
      />

      <SupplierDealTable
        title="RFQ quotations"
        empty="No RFQ quotations recorded for this supplier yet."
        headers={["RFQ", "Reference", "Amount", "Delivery", "Score", "Status"]}
        rows={quotes.map((row) => [
          tx(row.rfq_number ?? row.rfq_title),
          tx(row.reference),
          money(row.total_amount ?? 0),
          row.delivery_days ? `${num(row.delivery_days)} days` : "-",
          row.evaluation_score == null ? "-" : String(row.evaluation_score),
          tx(row.status),
        ])}
      />

      <SupplierDealTable
        title="Received materials and tools"
        empty="No stock has been received from this supplier yet."
        headers={["Item", "Category", "Receipts", "Quantity", "Last cost", "Last received"]}
        rows={items.map((row) => [
          `${tx(row.item_code)} - ${tx(row.item_name)}`,
          tx(row.category),
          String(num(row.receipt_count)),
          String(num(row.total_quantity_received)),
          money(row.last_unit_cost ?? 0),
          row.last_received_at ? new Date(row.last_received_at).toLocaleDateString() : "-",
        ])}
      />
    </div>
  );
}

function SupplierDealMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border border-ink-mid bg-ink-light/40 p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-paper">{value}</p>
      <p className="mt-1 font-mono text-xs text-signal">{detail}</p>
    </div>
  );
}

function SupplierDealTable({ title, empty, headers, rows }: { title: string; empty: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="border border-ink-mid bg-ink-light/40 p-4">
      <h3 className="mb-3 border-b border-ink-mid pb-3 font-mono text-xs font-bold uppercase tracking-widest text-paper">{title}</h3>
      {rows.length === 0 ? (
        <EmptyState label={empty} sub="Activity will appear here once it is recorded in procurement." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-ink-mid bg-ink/60 text-left">
                {headers.map((header) => <th key={header} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate">{header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${title}-${rowIndex}-${cellIndex}`} className={`px-3 py-2 ${cellIndex === 0 ? "text-paper" : "text-xs text-slate-light"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SupplierField({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">{label}{required ? " *" : ""}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
    </label>
  );
}

function SupplierSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
        {options.map((option) => <option key={option} value={option}>{option.replace("_", " ")}</option>)}
      </select>
    </label>
  );
}

function AddSupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: (temporaryPassword?: string, email?: string) => void; }) {
  const [form, setForm] = useState({
    supplier_name: "",
    trading_name: "",
    registration_number: "",
    tax_number: "",
    praz_number: "",
    nssa_number: "",
    primary_contact_name: "",
    primary_contact_email: "",
    primary_contact_phone: "",
  });
  const [issuePortalLogin, setIssuePortalLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!form.supplier_name.trim()) { setError("Supplier name is required."); return; }
    if (issuePortalLogin && !form.primary_contact_email.trim()) { setError("A contact email is required to issue a portal login."); return; }
    setSaving(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        supplier_name: form.supplier_name.trim(),
        trading_name: form.trading_name.trim() || undefined,
        registration_number: form.registration_number.trim() || undefined,
        tax_number: form.tax_number.trim() || undefined,
        praz_number: form.praz_number.trim() || undefined,
        nssa_number: form.nssa_number.trim() || undefined,
        primary_contact_name: form.primary_contact_name.trim() || undefined,
        primary_contact_email: form.primary_contact_email.trim() || undefined,
        primary_contact_phone: form.primary_contact_phone.trim() || undefined,
        currency: "USD",
        status: "pending_approval",
        compliance_status: "pending",
        issue_portal_login: issuePortalLogin,
      };
      const res = await createSupplierRecord(payload);
      if (!res?.data?.id) throw new Error("Supplier response did not include an id.");
      onCreated(res.data.temporary_password, form.primary_contact_email.trim() || undefined);
    } catch (e) {
      setError(normalizeActionError(e, "Could not create supplier."));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 shadow-2xl">
        <div className="flex items-start justify-between border-b border-ink-mid pb-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Register Supplier</p>
            <h2 className="mt-1 text-xl font-semibold text-paper">New Supplier</h2>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3.5 py-4">
          {error && <Banner tone="error" message={error} />}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Supplier Name *</label>
            <input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Trading Name</label>
              <input value={form.trading_name} onChange={(e) => setForm({ ...form, trading_name: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Registration Number</label>
              <input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Tax Number</label>
              <input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">PRAZ Number</label>
              <input value={form.praz_number} onChange={(e) => setForm({ ...form, praz_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">NSSA Number</label>
              <input value={form.nssa_number} onChange={(e) => setForm({ ...form, nssa_number: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
          </div>
          <div className="border-t border-ink-mid pt-3.5">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate">Primary Contact</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Name</label>
                <input value={form.primary_contact_name} onChange={(e) => setForm({ ...form, primary_contact_name: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Phone</label>
                <input value={form.primary_contact_phone} onChange={(e) => setForm({ ...form, primary_contact_phone: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Email</label>
                <input type="email" value={form.primary_contact_email} onChange={(e) => setForm({ ...form, primary_contact_email: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
              </div>
            </div>
          </div>
          <label className="flex items-start gap-2 border border-ink-mid p-3 text-xs text-slate-light">
            <input type="checkbox" checked={issuePortalLogin} onChange={(e) => setIssuePortalLogin(e.target.checked)} className="mt-0.5" />
            <span>Issue a supplier portal login for this contact now, using the email above. A one-time password is generated for you to hand over directly. Requires elevated (settings) access — if you don&apos;t have it, uncheck this and the supplier is still registered normally.</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-ink-mid pt-4">
          <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => void submit()} disabled={saving} className="inline-flex h-10 items-center gap-2 bg-signal px-5 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Register Supplier
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialsIssuedModal({ credentials, onClose }: { credentials: { email: string; temporary_password: string }; onClose: () => void; }) {
  const [copied, setCopied] = useState(false);
  const portalUrl = typeof window !== "undefined" ? `${window.location.origin}/portal/supplier` : "/portal/supplier";
  const copyLoginCard = async () => {
    try {
      await navigator.clipboard.writeText([
        `Supplier portal: ${portalUrl}`,
        `Email: ${credentials.email}`,
        `Temporary password: ${credentials.temporary_password}`,
      ].join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md border border-signal/40 bg-ink p-5 shadow-2xl">
        <h2 className="text-xl font-semibold text-paper">Portal Login Issued</h2>
        <p className="mt-2 text-xs text-slate-light">Copy this password now and hand it to them directly — it will not be shown again, and they must change it on first login.</p>
        <div className="mt-4 space-y-2">
          <div className="border border-ink-mid bg-ink-light p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Supplier portal</p>
            <p className="mt-1 break-all font-mono text-xs text-paper">{portalUrl}</p>
          </div>
          <div className="border border-ink-mid bg-ink-light p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Sign-in email</p>
            <p className="mt-1 break-all font-mono text-xs text-paper">{credentials.email}</p>
          </div>
          <div className="border border-signal/40 bg-signal/5 p-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate">Temporary password</p>
            <p className="mt-1 break-all font-mono text-xs text-paper">{credentials.temporary_password}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button onClick={() => void copyLoginCard()} className="h-10 border border-ink-mid font-mono text-xs font-bold uppercase text-paper hover:border-signal">{copied ? "Copied" : "Copy login"}</button>
          <button onClick={onClose} className="h-10 bg-signal font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90">Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Invoices Tab ─────────────────────────────────────────────────────────────

function InvoicesTab({ rows, unmatchedCount, saving, onMatch, onApprovePayment }: { rows: Rec[]; unmatchedCount: number; saving: string | null; onMatch: (row: Rec) => void; onApprovePayment: (row: Rec) => void; }) {
  return (
    <>
      {unmatchedCount > 0 && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-300">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <span><strong>{unmatchedCount}</strong> invoice{unmatchedCount !== 1 ? "s" : ""} have no matching PO or GRN — review before payment authorisation.</span>
        </div>
      )}
      <div className="border-b border-blue-500/20 bg-blue-950/10 p-4 text-xs text-blue-200">
        Payment approval is evidence-gated for PO invoices. Store-only invoice intakes remain visible here for audit, but they are not sent through three-way matching.
      </div>
      {rows.length === 0 ? (
        <EmptyState label="No invoices match this filter." sub="PO invoices and store invoice intakes appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-ink-mid bg-ink-light/50 text-left">
                {["Invoice #", "Supplier Ref", "Supplier", "PO #", "Invoice Date", "Total", "Match Status", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid">
              {rows.map((row) => {
                const matchSt = tx(row.match_status ?? row.matching_status, "unmatched").toLowerCase();
                const isRisk = matchSt === "unmatched" || matchSt === "disputed";
                const isMatched = matchSt === "matched";
                const canMatch = Boolean(row.po_id && row.grn_id);
                const status = tx(row.status, "received").toLowerCase();
                return (
                  <tr key={row.id} className={`hover:bg-ink-light/40 ${isRisk ? "bg-red-950/10" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs text-signal">{tx(row.invoice_number ?? row.reference_number, row.id.slice(0, 8).toUpperCase())}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.supplier_invoice_ref ?? row.external_reference)}</td>
                    <td className="px-4 py-3 text-paper">{tx(row.supplier_name)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-light">{tx(row.po_number ?? row.purchase_order_number)}</td>
                    <td className="px-4 py-3 text-slate-light">{dt(row.invoice_date)}</td>
                    <td className="px-4 py-3 font-mono text-paper">{money(row.total_amount ?? row.amount ?? 0)}</td>
                    <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${matchStatusClass(matchSt)}`}>{matchSt}</span></td>
                    <td className="px-4 py-3"><span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(row.status)}`}>{tx(row.status, "pending")}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {!isMatched && canMatch && (
                          <button onClick={() => onMatch(row)} disabled={saving === `match-invoice-${row.id}`}
                            className="inline-flex items-center gap-1 border border-blue-500/40 px-2 py-1 font-mono text-[10px] uppercase text-blue-300 hover:bg-blue-950/30 disabled:opacity-40">
                            <BadgeCheck className="h-3 w-3" />Match
                          </button>
                        )}
                        {!isMatched && !canMatch && (
                          <span className="border border-slate-500/30 bg-slate-950/20 px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                            Store intake
                          </span>
                        )}
                        {isMatched && status !== "approved" && (
                          <button onClick={() => onApprovePayment(row)} disabled={saving === `pay-invoice-${row.id}`}
                            className="inline-flex items-center gap-1 border border-emerald-500/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40">
                            <DollarSign className="h-3 w-3" />Approve with evidence
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PaymentEvidenceModal({ invoice, saving, onSubmit, onClose }: { invoice: Rec; saving: boolean; onSubmit: (payload: PaymentEvidencePayload) => void; onClose: () => void; }) {
  const [form, setForm] = useState<PaymentEvidencePayload>({
    poDocumentId: "",
    grnDocumentId: "",
    invoiceDocumentId: "",
    approvalDocumentId: "",
    reason: "PO, GRN, supplier invoice and payment approval evidence verified.",
  });
  const [error, setError] = useState<string | null>(null);
  const setField = (field: keyof PaymentEvidencePayload, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const submit = () => {
    const required: Array<keyof PaymentEvidencePayload> = ["poDocumentId", "grnDocumentId", "invoiceDocumentId", "approvalDocumentId"];
    if (required.some((field) => !form[field].trim())) {
      setError("All four document IDs are required before payment approval.");
      return;
    }
    setError(null);
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Payment Evidence Gate</p>
            <h2 className="mt-1 text-xl font-semibold">Approve supplier invoice payment</h2>
            <p className="mt-1 text-sm text-slate-light">{tx(invoice.invoice_number ?? invoice.reference_number, invoice.id)} · {money(invoice.total_amount ?? invoice.amount ?? 0)}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper disabled:opacity-40"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-5 p-5">
          {error && <Banner tone="error" message={error} />}
          <div className="border border-blue-500/25 bg-blue-950/10 p-4 text-sm text-blue-100">
            Finance approval requires linked evidence for the purchase order, confirmed goods receipt, supplier invoice and the payment approval decision. Search and select existing controlled documents from Enterprise Document Management.
          </div>
          <div className="grid gap-4">
            <DocumentPicker label="Purchase order evidence" value={form.poDocumentId} onChange={(v) => setField("poDocumentId", v)} entityId={tx(invoice.po_id)} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint={tx(invoice.po_number ?? invoice.purchase_order_number, "purchase order")} />
            <DocumentPicker label="Goods received evidence" value={form.grnDocumentId} onChange={(v) => setField("grnDocumentId", v)} entityId={tx(invoice.grn_id)} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint="GRN goods received" />
            <DocumentPicker label="Supplier invoice evidence" value={form.invoiceDocumentId} onChange={(v) => setField("invoiceDocumentId", v)} entityId={invoice.id} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint={tx(invoice.supplier_invoice_ref ?? invoice.invoice_number, "supplier invoice")} />
            <DocumentPicker label="Payment approval evidence" value={form.approvalDocumentId} onChange={(v) => setField("approvalDocumentId", v)} entityId={invoice.id} projectId={typeof invoice.project_id === "string" ? invoice.project_id : undefined} searchHint="payment approval" />
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Approval reason</label>
              <textarea value={form.reason} onChange={(e) => setField("reason", e.target.value)} rows={3} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper outline-none focus:border-signal" />
            </div>
          </div>
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-ink-mid bg-ink p-5">
          <button onClick={onClose} disabled={saving} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:text-paper disabled:opacity-40">Cancel</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-5 py-2 font-mono text-xs uppercase text-ink hover:bg-signal-light disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}Link evidence and approve
          </button>
        </footer>
      </aside>
    </div>
  );
}

function DocumentPicker({ label, value, onChange, entityId, projectId, searchHint }: { label: string; value: string; onChange: (value: string) => void; entityId: string; projectId?: string; searchHint: string; }) {
  const [search, setSearch] = useState(searchHint);
  const [documents, setDocuments] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = documents.find((doc) => doc.id === value);
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDocuments({
        search: search.trim() || undefined,
        project_id: projectId,
      });
      setDocuments(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(normalizeActionError(e, "Documents could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [projectId, search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadDocuments();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [loadDocuments]);

  return (
    <div className="border border-ink-mid bg-ink-light/40 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="block font-mono text-[10px] uppercase tracking-wider text-slate">{label} *</label>
        <span className="truncate font-mono text-[10px] text-slate">Target: {entityId}</span>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by document title, file name or document number" className="w-full border border-ink-mid bg-ink px-9 py-2 text-sm text-paper outline-none focus:border-signal" />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-signal" />}
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">
        {documents.length === 0 && !loading ? (
          <p className="border border-dashed border-ink-mid p-3 text-xs text-slate-light">No controlled documents found. Upload or register the document in Document Management, then search again.</p>
        ) : documents.map((doc) => {
          const active = doc.id === value;
          return (
            <button key={doc.id} type="button" onClick={() => onChange(doc.id)}
              className={`w-full border p-3 text-left transition ${active ? "border-signal bg-signal/10" : "border-ink-mid bg-ink hover:border-signal/50"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-paper">{tx(doc.title, "Untitled document")}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate">{tx(doc.doc_number ?? doc.document_number)} · {tx(doc.file_name)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <span className="border border-blue-500/30 px-1.5 py-0.5 font-mono text-[9px] uppercase text-blue-300">{tx(doc.category, "document")}</span>
                  <span className="border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-300">{tx(doc.status, "draft")}</span>
                </div>
              </div>
              {active && <p className="mt-2 font-mono text-[10px] text-signal">Selected: {doc.id}</p>}
            </button>
          );
        })}
      </div>
      {value && !selected && <p className="mt-2 font-mono text-[10px] text-signal">Selected document ID: {value}</p>}
    </div>
  );
}

// ─── Create PR Modal ──────────────────────────────────────────────────────────

function CreatePRModal({ projects, onClose, onCreated }: { projects: Rec[]; onClose: () => void; onCreated: () => void; }) {
  const [form, setForm] = useState({ project_id: "", priority: "normal", required_by_date: "", justification: "" });
  const [lines, setLines] = useState<LineItem[]>([{ description: "", qty: "1", uom: "ea", unit_cost: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLine = () => setLines((prev) => [...prev, { description: "", qty: "1", uom: "ea", unit_cost: "" }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));
  const setLine = (i: number, field: keyof LineItem, val: string) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const estimatedTotal = lines.reduce((s, l) => s + num(l.qty) * num(l.unit_cost), 0);

  const submit = async () => {
    if (!form.required_by_date) { setError("Required-by date is mandatory."); return; }
    if (lines.some((l) => !l.description.trim())) { setError("All line items must have a description."); return; }
    setSaving(true); setError(null);
    try {
      await createProcurementRequisition({
        ...form,
        project_id: form.project_id || null,
        line_items: lines.map((l) => ({ ...l, qty: num(l.qty), unit_cost: num(l.unit_cost) })),
      });
      onCreated();
    } catch (e) { setError(normalizeActionError(e, "Could not create requisition.")); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">New Purchase Requisition</p>
            <h2 className="mt-1 text-xl font-semibold">Create PR</h2>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-5 p-5">
          {error && <Banner tone="error" message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Project</label>
              <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
                <option value="">Not project-specific</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {tx(p.name ?? p.project_name ?? p.project_code, p.id)}{p.status === "field_intake" ? " (Field Intake)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Required By *</label>
              <input type="date" value={form.required_by_date} onChange={(e) => setForm({ ...form, required_by_date: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Business Justification</label>
              <textarea value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="Explain why this procurement is required…" rows={3} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper resize-none" />
            </div>
          </div>
          {/* Line items */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Line Items</p>
              <button onClick={addLine} className="inline-flex items-center gap-1 border border-signal/40 px-2 py-1 font-mono text-[10px] uppercase text-signal hover:bg-signal/10">
                <Plus className="h-3 w-3" />Add Row
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid gap-2 border border-ink-mid p-3 sm:grid-cols-[1fr_60px_60px_90px_auto]">
                  <input value={line.description} onChange={(e) => setLine(i, "description", e.target.value)} placeholder="Item description" className="h-9 border border-ink-mid bg-ink px-3 text-sm text-paper" />
                  <input value={line.qty} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="Qty" type="number" min="1" className="h-9 border border-ink-mid bg-ink px-2 text-sm text-paper" />
                  <input value={line.uom} onChange={(e) => setLine(i, "uom", e.target.value)} placeholder="UOM" className="h-9 border border-ink-mid bg-ink px-2 text-sm text-paper" />
                  <input value={line.unit_cost} onChange={(e) => setLine(i, "unit_cost", e.target.value)} placeholder="Unit cost" type="number" min="0" className="h-9 border border-ink-mid bg-ink px-2 text-sm text-paper" />
                  <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="flex items-center justify-center border border-ink-mid p-2 text-slate hover:border-red-500/40 hover:text-red-400 disabled:opacity-30">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <p className="font-mono text-sm text-paper">Est. Total: <span className="text-signal">{money(estimatedTotal)}</span></p>
            </div>
          </div>
          {/* Self-approval warning */}
          <div className="flex items-start gap-3 border border-amber-500/20 bg-amber-950/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-300">
              <strong>Self-approval prevention:</strong> Once submitted, this requisition must be approved by a different authorised user. The submitter cannot approve their own PR.
            </p>
          </div>
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-ink-mid bg-ink p-4">
          <button onClick={onClose} className="h-10 border border-ink-mid px-4 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => void submit()} disabled={saving} className="inline-flex h-10 items-center gap-2 bg-signal px-5 font-mono text-xs font-bold uppercase text-ink disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit Requisition
          </button>
        </footer>
      </aside>
    </div>
  );
}

function CreateRfqModal({ pr, saving, onCreate, onClose }: { pr: Rec; saving: boolean; onCreate: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ title: tx(pr.requisition_number ?? pr.pr_number, "RFQ"), closing_date: "", description: tx(pr.justification, "") });
  const submit = () => onCreate({ ...form, closing_date: form.closing_date || null, issue_now: true });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Issue RFQ</p>
            <h3 className="mt-1 text-xl font-semibold">Create request for quotation</h3>
            <p className="mt-1 text-xs text-slate-light">PR {tx(pr.requisition_number ?? pr.pr_number, pr.id)}</p>
          </div>
          <button onClick={onClose} className="text-slate hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 space-y-3">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="RFQ title" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <input type="date" value={form.closing_date} onChange={(e) => setForm({ ...form, closing_date: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Scope / supplier instructions" rows={4} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 font-mono text-xs uppercase text-ink disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Issue RFQ</button>
        </div>
      </div>
    </div>
  );
}

function RfqResponseModal({ rfq, suppliers, saving, onSubmit, onClose }: { rfq: Rec; suppliers: Rec[]; saving: boolean; onSubmit: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ supplier_id: "", reference: "", total_amount: "", delivery_days: "", validity_days: "30", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!form.supplier_id) { setError("Select a supplier."); return; }
    if (num(form.total_amount) < 0 || !form.total_amount) { setError("Enter a quotation amount."); return; }
    setError(null);
    onSubmit({
      supplier_id: form.supplier_id,
      reference: form.reference || null,
      total_amount: num(form.total_amount),
      delivery_days: form.delivery_days ? Number(form.delivery_days) : null,
      validity_days: Number(form.validity_days || 30),
      notes: form.notes || null,
      line_items: [],
    });
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Supplier quotation</p>
            <h3 className="mt-1 text-xl font-semibold">{tx(rfq.rfq_number, rfq.id)}</h3>
          </div>
          <button onClick={onClose} className="text-slate hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        {error && <div className="mt-4 border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>}
        <div className="mt-5 space-y-3">
          <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{tx(supplier.supplier_name ?? supplier.name, supplier.id)}</option>)}
          </select>
          <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Supplier quote reference" className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          <div className="grid gap-3 sm:grid-cols-3">
            <input value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} placeholder="Total amount" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <input value={form.delivery_days} onChange={(e) => setForm({ ...form, delivery_days: e.target.value })} placeholder="Delivery days" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            <input value={form.validity_days} onChange={(e) => setForm({ ...form, validity_days: e.target.value })} placeholder="Validity days" className="h-10 border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Evaluation notes" rows={3} className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 bg-signal px-4 py-2 font-mono text-xs uppercase text-ink disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Record quote</button>
        </div>
      </div>
    </div>
  );
}

function CreatePOModal({ pr, suppliers, saving, onCreate, onClose }: { pr: Rec; suppliers: Rec[]; saving: boolean; onCreate: (supplierId: string, supplierSelectionReason: string) => void; onClose: () => void; }) {
  const [supplierId, setSupplierId] = useState("");
  const [supplierSelectionReason, setSupplierSelectionReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Create Purchase Order</p>
            <h2 className="mt-1 text-lg font-semibold">{tx(pr.requisition_number ?? pr.pr_number ?? pr.reference_number, pr.id.slice(0, 8).toUpperCase())}</h2>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 p-5">
          <InfoCard label="Estimated Total" value={money(pr.total_estimated ?? pr.estimated_total ?? 0)} tone="text-signal" />
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Supplier *</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">Select supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{tx(s.supplier_name ?? s.name, s.id)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Supplier selection rationale *</label>
            <textarea
              value={supplierSelectionReason}
              onChange={(e) => setSupplierSelectionReason(e.target.value)}
              rows={3}
              placeholder="Record why this supplier is being selected without an RFQ quotation decision."
              className="w-full resize-none border border-ink-mid bg-ink-light p-3 text-sm text-paper placeholder:text-slate"
            />
            <p className="mt-1 text-[11px] text-slate-light">Required for direct POs to avoid unexplained supplier selection.</p>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onCreate(supplierId, supplierSelectionReason)} disabled={saving || !supplierId || supplierSelectionReason.trim().length < 12} className="inline-flex h-9 items-center gap-2 bg-signal px-4 font-mono text-xs font-bold uppercase text-ink disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Create PO
          </button>
        </footer>
      </div>
    </div>
  );
}

function ReceiveGoodsModal({ po, stores, saving, onSubmit, onClose }: { po: Rec; stores: Rec[]; saving: boolean; onSubmit: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ store_id: "", delivery_date: new Date().toISOString().slice(0, 10), delivery_note_ref: "", condition_notes: "" });
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Goods Received Note</p>
            <h2 className="mt-1 text-lg font-semibold">{tx(po.po_number ?? po.reference_number, po.id.slice(0, 8).toUpperCase())}</h2>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-3 p-5">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Delivery Date *</label>
            <input type="date" value={form.delivery_date} onChange={(e) => set("delivery_date", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Receiving Store</label>
            <select value={form.store_id} onChange={(e) => set("store_id", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">No stock store selected</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{tx(store.name ?? store.store_code, store.id)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Delivery Note Ref</label>
            <input value={form.delivery_note_ref} onChange={(e) => set("delivery_note_ref", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Condition Notes</label>
            <textarea value={form.condition_notes} onChange={(e) => set("condition_notes", e.target.value)} rows={3} className="w-full resize-none border border-ink-mid bg-ink-light p-3 text-sm text-paper" />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onSubmit({ po_id: po.id, store_id: form.store_id || null, delivery_date: form.delivery_date, delivery_note_ref: form.delivery_note_ref || null, condition_notes: form.condition_notes || null })} disabled={saving || !form.delivery_date} className="inline-flex h-9 items-center gap-2 border border-emerald-500/50 bg-emerald-950/30 px-4 font-mono text-xs font-bold uppercase text-emerald-300 disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}Confirm GRN
          </button>
        </footer>
      </div>
    </div>
  );
}

function SupplierInvoiceModal({ po, saving, onSubmit, onClose }: { po: Rec; saving: boolean; onSubmit: (payload: Record<string, unknown>) => void; onClose: () => void; }) {
  const [form, setForm] = useState({ grn_id: "", supplier_invoice_ref: "", invoice_date: new Date().toISOString().slice(0, 10), due_date: "", subtotal: String(num(po.total_amount ?? 0)), tax_amount: "0", notes: "" });
  const grns: Rec[] = Array.isArray(po.grns) ? po.grns : Array.isArray(po.goods_receipts) ? po.goods_receipts : [];
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Register Supplier Invoice</p>
            <h2 className="mt-1 text-lg font-semibold">{tx(po.po_number ?? po.reference_number, po.id.slice(0, 8).toUpperCase())}</h2>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-3 p-5">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Supplier Invoice Ref *</label>
            <input value={form.supplier_invoice_ref} onChange={(e) => set("supplier_invoice_ref", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Confirmed GRN</label>
            <select value={form.grn_id} onChange={(e) => set("grn_id", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper">
              <option value="">No GRN selected</option>
              {grns.map((grn) => <option key={grn.id} value={grn.id}>{tx(grn.grn_number, grn.id)}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Invoice Date *</label>
              <input type="date" value={form.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Subtotal *</label>
              <input type="number" min="0" value={form.subtotal} onChange={(e) => set("subtotal", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Tax</label>
              <input type="number" min="0" value={form.tax_amount} onChange={(e) => set("tax_amount", e.target.value)} className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper" />
            </div>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onSubmit({ po_id: po.id, grn_id: form.grn_id || null, supplier_invoice_ref: form.supplier_invoice_ref, invoice_date: form.invoice_date, due_date: form.due_date || null, subtotal: num(form.subtotal), tax_amount: num(form.tax_amount), notes: form.notes || null })} disabled={saving || !form.supplier_invoice_ref || !form.invoice_date} className="inline-flex h-9 items-center gap-2 border border-blue-500/50 bg-blue-950/30 px-4 font-mono text-xs font-bold uppercase text-blue-300 disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Register Invoice
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── PO Detail Drawer ─────────────────────────────────────────────────────────

function PODetailDrawer({ po, saving, onApprove, onIssue, onReceive, onInvoice, onMatchInvoice, onApprovePayment, onClose }: { po: Rec; saving: string | null; onApprove: (po: Rec) => void; onIssue: (po: Rec) => void; onReceive: (po: Rec) => void; onInvoice: (po: Rec) => void; onMatchInvoice: (invoice: Rec) => void; onApprovePayment: (invoice: Rec) => void; onClose: () => void; }) {
  const lines: Rec[] = Array.isArray(po.lines) ? po.lines : Array.isArray(po.line_items) ? po.line_items : [];
  const grns: Rec[] = Array.isArray(po.grns) ? po.grns : Array.isArray(po.goods_receipts) ? po.goods_receipts : [];
  const invLines: Rec[] = Array.isArray(po.invoices) ? po.invoices : [];
  const status = tx(po.status, "draft").toLowerCase();
  const hasIssued = ["issued", "partially_received", "received", "closed"].includes(status) || Boolean(po.issued_date);
  const hasGrn = grns.length > 0 || ["partially_received", "received", "closed"].includes(status);
  const hasInvoice = invLines.length > 0;
  const hasMatchedInvoice = invLines.some((inv) => tx(inv.match_status ?? inv.matching_status).toLowerCase() === "matched");
  const hasPaymentApproval = invLines.some((inv) => ["payment_approved", "approved_for_payment", "paid"].includes(tx(inv.status).toLowerCase()) || ["approved", "paid"].includes(tx(inv.payment_status).toLowerCase()));
  const scenarioSteps = [
    { label: "PO created", detail: "Supplier and approved requisition captured", complete: true },
    { label: "Finance commitment", detail: "Issue PO to create project commitment", complete: hasIssued },
    { label: "Goods received", detail: "Record GRN and update stock ledger", complete: hasGrn },
    { label: "Supplier invoice", detail: "Register invoice against PO and GRN", complete: hasInvoice },
    { label: "Three-way match", detail: "Match PO, GRN and supplier invoice", complete: hasMatchedInvoice },
    { label: "Payment evidence gate", detail: "Approve only with PO, GRN, invoice and approval evidence", complete: hasPaymentApproval },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-ink-mid bg-ink text-paper shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-ink-mid bg-ink p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Purchase Order</p>
            <h2 className="mt-1 text-2xl font-semibold">{tx(po.po_number ?? po.reference_number, po.id.slice(0, 8).toUpperCase())}</h2>
            <p className="mt-1 text-xs text-slate-light">
              {tx(po.supplier_name)} · {tx(po.project_name ?? po.project)} ·{" "}
              <span className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase ${poStatusClass(po.status)}`}>{tx(po.status)}</span>
            </p>
          </div>
          <button onClick={onClose} className="border border-ink-mid p-2 text-slate-light hover:border-signal hover:text-paper"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 p-5">
          <section className="border border-signal/25 bg-signal/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Scenario A completion rail</p>
                <h3 className="mt-1 text-base font-semibold text-paper">Procurement-to-payment control path</h3>
                <p className="mt-1 text-xs text-slate-light">This PO must progress through commitment, GRN, invoice, three-way match and evidence-gated payment approval.</p>
              </div>
              <span className="border border-ink-mid px-2 py-1 font-mono text-[10px] uppercase text-slate-light">
                {scenarioSteps.filter((step) => step.complete).length}/{scenarioSteps.length} controls complete
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {scenarioSteps.map((step) => (
                <div key={step.label} className={`flex items-start gap-3 border p-3 ${step.complete ? "border-emerald-500/25 bg-emerald-950/10" : "border-ink-mid bg-ink/60"}`}>
                  <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${step.complete ? "text-emerald-300" : "text-slate"}`} />
                  <div>
                    <p className={`font-mono text-[10px] uppercase tracking-wider ${step.complete ? "text-emerald-200" : "text-slate-light"}`}>{step.label}</p>
                    <p className="mt-1 text-xs text-slate-light">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <div className="flex flex-wrap gap-2 border border-ink-mid bg-ink-light/30 p-3">
            {status === "draft" && (
              <button onClick={() => onApprove(po)} disabled={saving === `approve-po-${po.id}`}
                className="inline-flex h-9 items-center gap-2 border border-emerald-500/40 px-3 font-mono text-xs uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40">
                {saving === `approve-po-${po.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve PO
              </button>
            )}
            {["draft", "approved"].includes(status) && (
              <button onClick={() => onIssue(po)} disabled={saving === `issue-po-${po.id}`}
                className="inline-flex h-9 items-center gap-2 border border-purple-500/40 px-3 font-mono text-xs uppercase text-purple-300 hover:bg-purple-950/30 disabled:opacity-40">
                <Send className="h-4 w-4" />Issue PO
              </button>
            )}
            {["issued", "partially_received"].includes(status) && (
              <button onClick={() => onReceive(po)} className="inline-flex h-9 items-center gap-2 border border-emerald-500/40 px-3 font-mono text-xs uppercase text-emerald-300 hover:bg-emerald-950/30">
                <PackageCheck className="h-4 w-4" />Record GRN
              </button>
            )}
            {["received", "partially_received"].includes(status) && (
              <button onClick={() => onInvoice(po)} className="inline-flex h-9 items-center gap-2 border border-blue-500/40 px-3 font-mono text-xs uppercase text-blue-300 hover:bg-blue-950/30">
                <FileText className="h-4 w-4" />Register Invoice
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoCard label="Total Amount" value={money(po.total_amount ?? po.amount ?? 0)} tone="text-signal" />
            <InfoCard label="Issued Date" value={dt(po.issued_date ?? po.created_at)} />
            <InfoCard label="Expected Delivery" value={dt(po.expected_delivery_date ?? po.expected_delivery)} />
          </div>
          {/* PO Lines */}
          <section className="border border-ink-mid">
            <div className="border-b border-ink-mid bg-ink-light/40 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">PO Lines ({lines.length})</p>
            </div>
            {lines.length === 0 ? <p className="p-4 text-sm text-slate-light">No line items on this PO.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
                  <thead><tr className="border-b border-ink-mid text-left">{["Description", "Qty", "UOM", "Unit Price", "Line Total"].map((h) => <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase text-slate">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-ink-mid">
                    {lines.map((line, i) => (
                      <tr key={line.id ?? i}>
                        <td className="px-4 py-2 text-paper">{tx(line.description ?? line.item_description)}</td>
                        <td className="px-4 py-2 font-mono text-slate-light">{num(line.qty ?? line.quantity)}</td>
                        <td className="px-4 py-2 text-slate-light">{tx(line.uom ?? line.unit_of_measure)}</td>
                        <td className="px-4 py-2 font-mono text-paper">{money(line.unit_price ?? line.unit_cost ?? 0)}</td>
                        <td className="px-4 py-2 font-mono text-paper">{money(num(line.qty ?? line.quantity) * num(line.unit_price ?? line.unit_cost ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {/* GRN history */}
          <section className="border border-ink-mid">
            <div className="border-b border-ink-mid bg-ink-light/40 px-4 py-3 flex items-center gap-2">
              <Truck className="h-4 w-4 text-slate" />
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">GRN History ({grns.length})</p>
            </div>
            {grns.length === 0 ? <p className="p-4 text-sm text-slate-light">No goods receipts recorded yet.</p> : (
              <div className="divide-y divide-ink-mid">
                {grns.map((grn, i) => (
                  <div key={grn.id ?? i} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3">
                    <div>
                      <p className="text-sm text-paper">{tx(grn.grn_number ?? grn.reference_number)}</p>
                      <p className="mt-0.5 text-xs text-slate-light">{dt(grn.received_date ?? grn.created_at)} · Received by {tx(grn.received_by)}</p>
                    </div>
                    <span className={`self-start border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(grn.status)}`}>{tx(grn.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          {/* Invoice matching */}
          <section className="border border-ink-mid">
            <div className="border-b border-ink-mid bg-ink-light/40 px-4 py-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate" />
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate">Invoice Matching ({invLines.length})</p>
            </div>
            {invLines.length === 0 ? <p className="p-4 text-sm text-slate-light">No invoices linked to this PO.</p> : (
              <div className="divide-y divide-ink-mid">
                {invLines.map((inv, i) => {
                  const matchStatus = tx(inv.match_status ?? inv.matching_status, "unmatched").toLowerCase();
                  const paymentStatus = tx(inv.payment_status ?? inv.status, "pending").toLowerCase();
                  const matched = matchStatus === "matched";
                  const paymentApproved = ["payment_approved", "approved_for_payment", "approved", "paid"].includes(paymentStatus);
                  return (
                  <div key={inv.id ?? i} className="grid gap-4 px-4 py-3 md:grid-cols-[1fr_auto]">
                    <div>
                      <p className="text-sm text-paper">{tx(inv.invoice_number ?? inv.reference_number)}</p>
                      <p className="mt-0.5 text-xs text-slate-light">{dt(inv.invoice_date)} · {money(inv.total_amount ?? 0)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${matchStatusClass(inv.match_status ?? inv.matching_status)}`}>{tx(inv.match_status ?? inv.matching_status, "unmatched")}</span>
                        <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${prStatusClass(inv.status)}`}>{tx(inv.status)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      {!matched && (
                        <button onClick={() => onMatchInvoice(inv)} disabled={saving === `match-invoice-${inv.id}`}
                          className="inline-flex h-8 items-center gap-1.5 border border-emerald-500/40 px-2 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40">
                          {saving === `match-invoice-${inv.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Three-way match
                        </button>
                      )}
                      {matched && !paymentApproved && (
                        <button onClick={() => onApprovePayment(inv)} disabled={saving === `pay-invoice-${inv.id}`}
                          className="inline-flex h-8 items-center gap-1.5 border border-signal/50 px-2 font-mono text-[10px] uppercase text-signal hover:bg-signal/10 disabled:opacity-40">
                          {saving === `pay-invoice-${inv.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}Approve with evidence
                        </button>
                      )}
                      {paymentApproved && <span className="border border-emerald-500/40 bg-emerald-950/20 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300">Payment gate cleared</span>}
                    </div>
                  </div>
                );})}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

// ─── Approve Modal ────────────────────────────────────────────────────────────

function ApproveModal({ pr, saving, onDecide, onClose }: { pr: Rec; saving: boolean; onDecide: (d: "approved" | "rejected", reason?: string) => void; onClose: () => void; }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">Approval Decision</p>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <p className="text-sm font-semibold text-paper">PR: {tx(pr.pr_number ?? pr.reference_number, pr.id.slice(0, 8).toUpperCase())}</p>
            <p className="mt-0.5 text-xs text-slate-light">{tx(pr.project_name ?? pr.project)} · Est. {money(pr.total_estimated ?? 0)}</p>
          </div>
          {pr.justification && (
            <div className="border border-ink-mid p-3">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate">Justification</p>
              <p className="text-sm text-slate-light">{pr.justification}</p>
            </div>
          )}
          <div className="flex items-start gap-3 border border-blue-500/20 bg-blue-950/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <p className="text-xs text-blue-300">Budget check results are returned by the server on approval. Verify project budget allocation is sufficient before proceeding.</p>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate">Reason / Notes (required for rejection)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Provide rationale…" className="w-full border border-ink-mid bg-ink-light p-3 text-sm text-paper resize-none" />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-mid p-4">
          <button onClick={onClose} className="h-9 border border-ink-mid px-3 font-mono text-xs uppercase text-slate-light hover:text-paper">Cancel</button>
          <button onClick={() => onDecide("rejected", reason)} disabled={saving || !reason.trim()} className="inline-flex h-9 items-center gap-1.5 border border-red-500/40 px-3 font-mono text-xs uppercase text-red-300 hover:bg-red-950/30 disabled:opacity-40">
            <XCircle className="h-3.5 w-3.5" />Reject
          </button>
          <button onClick={() => onDecide("approved", reason || undefined)} disabled={saving} className="inline-flex h-9 items-center gap-1.5 bg-emerald-700 px-4 font-mono text-xs font-bold uppercase text-white hover:bg-emerald-600 disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Approve
          </button>
        </footer>
      </div>
    </div>
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

// ─── Shared primitives ────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, tone, large }: { icon: ReactNode; label: string; value: string; tone?: string; large?: boolean; }) {
  return (
    <div className="border border-ink-mid bg-ink p-4">
      <div className="flex items-center justify-between text-slate">
        <p className="font-mono text-[10px] uppercase tracking-wider">{label}</p>
        <span className="text-signal [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      </div>
      <p className={`mt-4 font-mono ${large ? "text-xl" : "text-2xl"} ${tone ?? "text-paper"}`}>{value}</p>
    </div>
  );
}

function Banner({ tone, message, onClose }: { tone: "error" | "info"; message: string; onClose?: () => void; }) {
  const style = tone === "error" ? "border-red-500/30 bg-red-950/20 text-red-200" : "border-signal/30 bg-signal/10 text-slate-light";
  return (
    <div className={`mb-4 flex items-start gap-3 border p-4 text-sm ${style}`}>
      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} className="shrink-0 text-slate hover:text-paper"><X className="h-4 w-4" /></button>}
    </div>
  );
}

function LoadingState({ label }: { label: string; }) {
  return <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-light"><Loader2 className="h-5 w-5 animate-spin text-signal" />{label}</div>;
}

function EmptyState({ label, sub }: { label: string; sub: string; }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center p-6 text-center text-slate-light">
      <ClipboardList className="h-8 w-8 text-slate" />
      <p className="mt-3 text-sm text-paper">{label}</p>
      <p className="mt-1 text-xs">{sub}</p>
    </div>
  );
}

function InfoCard({ label, value, tone }: { label: string; value: string; tone?: string; }) {
  return (
    <div className="border border-ink-mid p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-slate">{label}</p>
      <p className={`mt-2 font-mono text-sm ${tone ?? "text-paper"}`}>{value}</p>
    </div>
  );
}
