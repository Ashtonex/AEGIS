"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  AlertTriangle, BadgeCheck, DollarSign, Loader2, Plus, RefreshCw, Search,
  ShieldCheck, TrendingUp, TrendingDown, Users, X, BarChart3, Receipt,
  FileText, ClipboardList, CheckCircle2, CircleHelp, ChevronDown, ChevronRight, FolderKanban, PanelRightOpen
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Skeleton, SkeletonTableRows } from "@/components/ui/Skeleton";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useFinanceDepartments } from "@/hooks/useFinanceDepartments";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { useModuleTour } from "@/hooks/useModuleTour";
import { ModuleTour, type ModuleTourStep } from "@/components/onboarding/ModuleTour";
import {
  getFinanceProjectSummaries,
  getFinanceProjectDetail,
  getFinanceCostCodes,
  createFinanceCostCode,
  getFinanceVariations,
  createFinanceVariation,
  decideFinanceVariation,
  getFinanceProgressClaims,
  createFinanceProgressClaim,
  certifyFinanceProgressClaim,
  recordProgressClaimFiscalInvoice,
  getFinanceBudgets,
  getFinanceDepartmentPnl,
  getBankStatementAllocationSummary,
  getInternalProjects
} from "@/lib/api";

// Only the active tab's panel ships to the browser instead of all 17 at
// once - each of these was previously a static import, so every visit to
// /dashboard/finance loaded all 17 panels' code regardless of which tab
// was open.
function PanelLoading() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-1/3" />
      <SkeletonTableRows rows={6} columns={4} />
    </div>
  );
}
const FinanceOperationsPanel = dynamic(() => import("./FinanceOperationsPanel").then((m) => m.FinanceOperationsPanel), { loading: PanelLoading });
const PayrollPanel = dynamic(() => import("./PayrollPanel").then((m) => m.PayrollPanel), { loading: PanelLoading });
const ProjectMoneyModal = dynamic(() => import("./ProjectMoneyModal").then((m) => m.ProjectMoneyModal), { ssr: false });
const ProjectFinancialsWorkspace = dynamic(() => import("./ProjectFinancialsWorkspace").then((m) => m.ProjectFinancialsWorkspace), { loading: PanelLoading });
const DepartmentTransfersPanel = dynamic(() => import("./DepartmentTransfersPanel").then((m) => m.DepartmentTransfersPanel), { loading: PanelLoading });
const StatutoryPanel = dynamic(() => import("./StatutoryPanel").then((m) => m.StatutoryPanel), { loading: PanelLoading });
const VendorPaymentsPanel = dynamic(() => import("./VendorPaymentsPanel").then((m) => m.VendorPaymentsPanel), { loading: PanelLoading });
const ClientPaymentsPanel = dynamic(() => import("./ClientPaymentsPanel").then((m) => m.ClientPaymentsPanel), { loading: PanelLoading });
const HistoricalEntryPanel = dynamic(() => import("./HistoricalEntryPanel").then((m) => m.HistoricalEntryPanel), { loading: PanelLoading });
const FinancialStatementsPanel = dynamic(() => import("./FinancialStatementsPanel").then((m) => m.FinancialStatementsPanel), { loading: PanelLoading });
const EarnedValuePanel = dynamic(() => import("./EarnedValuePanel").then((m) => m.EarnedValuePanel), { loading: PanelLoading });
const FinalAccountPanel = dynamic(() => import("./FinalAccountPanel").then((m) => m.FinalAccountPanel), { loading: PanelLoading });
const DataRoomPanel = dynamic(() => import("./DataRoomPanel").then((m) => m.DataRoomPanel), { loading: PanelLoading });
const GeneralLedgerPanel = dynamic(() => import("./GeneralLedgerPanel").then((m) => m.GeneralLedgerPanel), { loading: PanelLoading });
const CompanyBudgetPanel = dynamic(() => import("./CompanyBudgetPanel").then((m) => m.CompanyBudgetPanel), { loading: PanelLoading });
const CashForecastPanel = dynamic(() => import("./CashForecastPanel").then((m) => m.CashForecastPanel), { loading: PanelLoading });
const FinanceAssistantPanel = dynamic(() => import("./FinanceAssistantPanel").then((m) => m.FinanceAssistantPanel), { loading: PanelLoading });
const ManagementAccountsPanel = dynamic(() => import("./ManagementAccountsPanel").then((m) => m.ManagementAccountsPanel), { loading: PanelLoading });
const ProjectPortfolioPanel = dynamic(() => import("./ProjectPortfolioPanel").then((m) => m.ProjectPortfolioPanel), { loading: PanelLoading });
const BankStatementReviewPanel = dynamic(() => import("./BankStatementReviewPanel").then((m) => m.BankStatementReviewPanel), { loading: PanelLoading });
const AuditWorkspacePanel = dynamic(() => import("./AuditWorkspacePanel").then((m) => m.AuditWorkspacePanel), { loading: PanelLoading });
const FinanceOverviewDashboard = dynamic(() => import("./FinanceOverviewDashboard").then((m) => m.FinanceOverviewDashboard), { loading: PanelLoading, ssr: false });
const SupplierPaymentsPanel = dynamic(() => import("./SupplierPaymentsPanel").then((m) => m.SupplierPaymentsPanel), { loading: PanelLoading });
const ProjectBudgetsPanel = dynamic(() => import("./ProjectBudgetsPanel").then((m) => m.ProjectBudgetsPanel), { loading: PanelLoading });
const CostCodesByProjectPanel = dynamic(() => import("./CostCodesByProjectPanel").then((m) => m.CostCodesByProjectPanel), { loading: PanelLoading });

// Pages where entering a project's budget / variation / claim is relevant
// get the "Project quick entry" dropdown in the header, instead of a
// permanent side column that squeezed the main content.
const QUICK_ENTRY_TABS: FinanceTab[] = ["project-financials", "cost-codes", "variations", "progress-claims", "earned-value", "close-out", "budgets", "project-portfolio"];

type RecordData = Record<string, any>;
type FinanceTab = "overview" | "project-financials" | "cost-codes" | "variations" | "progress-claims" | "earned-value" | "close-out" | "budgets" | "banking" | "cash-accounts" | "cashbook" | "supplier-payments" | "payroll" | "transfers" | "department-pnl" | "statutory" | "vendor-payments" | "client-payments" | "historical-entry" | "financial-statements" | "data-room" | "general-ledger" | "cash-forecast" | "ai-assistant" | "management-accounts" | "project-portfolio" | "audit-workspace" | "bank-review";

const TAB_ROUTES: Record<FinanceTab, string> = {
  overview: "/dashboard/finance",
  "project-financials": "/dashboard/finance/project-financials",
  "cost-codes": "/dashboard/finance/cost-codes",
  variations: "/dashboard/finance/variations",
  "progress-claims": "/dashboard/finance/progress-claims",
  "earned-value": "/dashboard/finance/earned-value",
  "close-out": "/dashboard/finance/close-out",
  budgets: "/dashboard/finance/budgets",
  banking: "/dashboard/finance/banking",
  "cash-accounts": "/dashboard/finance/cash-accounts",
  cashbook: "/dashboard/finance/cashbook",
  "supplier-payments": "/dashboard/finance/supplier-payments",
  payroll: "/dashboard/finance/payroll",
  transfers: "/dashboard/finance/transfers",
  "department-pnl": "/dashboard/finance/department-pnl",
  statutory: "/dashboard/finance/statutory",
  "vendor-payments": "/dashboard/finance/vendor-payments",
  "client-payments": "/dashboard/finance/client-payments",
  "historical-entry": "/dashboard/finance/historical-entry",
  "financial-statements": "/dashboard/finance/financial-statements",
  "data-room": "/dashboard/finance/data-room",
  "general-ledger": "/dashboard/finance/general-ledger",
  "cash-forecast": "/dashboard/finance/cash-forecast",
  "ai-assistant": "/dashboard/finance/ai-assistant",
  "management-accounts": "/dashboard/finance/management-accounts",
  "project-portfolio": "/dashboard/finance/project-portfolio",
  "audit-workspace": "/dashboard/finance/audit-workspace",
  "bank-review": "/dashboard/finance/bank-review",
};

const FINANCE_TOUR_STEPS: ModuleTourStep[] = [
  {
    title: "Most of this ledger writes itself",
    body: "Almost nothing here is manual data entry. Costs, internal transfers, and statutory tax all post themselves as a side effect of things that happen elsewhere in the app - a won quote, a logged equipment hour, a certified claim, a payroll run. This tour points out where each number actually comes from.",
    placement: "center",
  },
  {
    title: "Consolidated vs one department",
    body: "Switch between the whole business and a single department's own view. A won quotation auto-seeds that project's budget from its own cost breakdown - protected profit excluded - so what was quoted and what's actually being spent are the same comparison.",
    target: "finance-departments",
    placement: "bottom",
  },
  {
    title: "These numbers are live, not entered",
    body: "Actual Cost, Committed Cost, and Forecast Margin are all SUM()s over real transactions - fleet usage, procurement, payroll - updated the instant something posts. If a project's forecast cost blows past its approved budget with no matching approved variation, Finance proactively notifies Executive/Finance Manager rather than waiting for someone to notice.",
    target: "finance-kpis",
    placement: "bottom",
  },
  {
    title: "Use the side navigation",
    body: "Progress Claims is where certifying a client claim happens - and that certification is also what triggers VAT to accrue automatically. Internal Transfers records money moving between departments. Move between Finance sections from the side navigation.",
    target: "dashboard-nav",
    placement: "bottom",
  },
  {
    title: "Statutory: the one place that needs your input first",
    body: "PAYE, NSSA, and VAT compute off real ZIMRA rate tables and accrue automatically once a claim is certified or payroll is posted. But those rate tables ship empty on purpose - until real rates are entered here, payroll hard-blocks (no silent $0 tax) and VAT falls back to a visible 15% default. This is the one manual step everything else depends on.",
    target: "dashboard-nav",
    placement: "bottom",
  },
];

function money(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}

function percent(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return `${(Number.isFinite(num) ? num : 0).toFixed(1)}%`;
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
    return "The finance feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Failed to load financial workspace data.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["approved", "certified", "invoiced", "paid", "incorporated", "matched"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["submitted", "pending", "matching", "partial_match"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  if (["rejected", "cancelled", "disputed", "over_invoice"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
}

export default function FinanceDashboard() {
  return <FinancePage initialTab="overview" />;
}

const FINANCE_TAB_LABELS: Record<FinanceTab, string> = {
  overview: "Finance & Cost Control",
  "project-financials": "Project Financials",
  "cost-codes": "Cost Codes",
  variations: "Variations",
  "progress-claims": "Progress Claims",
  "earned-value": "Earned Value",
  "close-out": "Close-Out",
  budgets: "Budgets",
  banking: "Banking & Cash",
  "cash-accounts": "Banking & Cash",
  cashbook: "Cashbook",
  "supplier-payments": "Supplier Payments",
  payroll: "Payroll",
  transfers: "Internal Transfers",
  "department-pnl": "Department P&L",
  statutory: "Statutory",
  "vendor-payments": "Vendor Payments",
  "client-payments": "Client Payments",
  "historical-entry": "Historical Entry",
  "financial-statements": "Financial Statements",
  "data-room": "Financial Data Room",
  "general-ledger": "General Ledger",
  "cash-forecast": "Cash Forecast",
  "ai-assistant": "AI Assistant",
  "management-accounts": "Management Accounts",
  "project-portfolio": "Project Portfolio",
  "audit-workspace": "Audit Workspace",
  "bank-review": "Bank Statement Review",
};

/** Shared Finance workspace, rendered by a real route per tab (see the
 * sibling folders under dashboard/finance/) instead of the old
 * finance/[tab] -> redirect() -> ?tab= shim - each route now has its own
 * URL, its own header title, and (via the tab's already-existing
 * next/dynamic panel) only loads the one panel it actually renders. */
export function FinancePage({ initialTab }: { initialTab: FinanceTab }) {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Project Manager", "Finance Manager", "Contracts Manager", "Commercial Manager", "Authorising Officer", "Executive Read Only", "External Auditor"]}>
      <FinanceWorkspace initialTab={initialTab} />
    </RBACGuard>
  );
}

function FinanceWorkspace({ initialTab }: { initialTab: FinanceTab }) {
  const router = useRouter();
  const financeTour = useModuleTour("finance");
  // Each route (see the sibling tab folders) mounts this component with a
  // fixed initialTab - no local mutation needed since switching tabs is now
  // a real navigation, not client-side state.
  const activeTab = initialTab;
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectDetail, setProjectDetail] = useState<RecordData | null>(null);
  const [moneyProjectId, setMoneyProjectId] = useState<string>("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [budgetsSubView, setBudgetsSubView] = useState<"project" | "company">("project");
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [claimGroupsOpen, setClaimGroupsOpen] = useState<Record<string, boolean>>({});
  const quickEntryRef = useRef<HTMLDivElement>(null);

  // The quick-entry dropdown closes on an outside click or Escape.
  useEffect(() => {
    if (!quickEntryOpen) return;
    const onDown = (e: MouseEvent) => {
      if (quickEntryRef.current && !quickEntryRef.current.contains(e.target as Node)) setQuickEntryOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setQuickEntryOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [quickEntryOpen]);

  const [detailLoading, setDetailLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal States
  const [showCostCodeModal, setShowCostCodeModal] = useState(false);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);

  // Form Fields
  const [newCostCode, setNewCostCode] = useState({ code: "", name: "", category: "materials" });
  const [newVariation, setNewVariation] = useState({ variation_number: "", project_id: "", title: "", description: "", cost_impact: "0", time_impact_days: "0", initiated_by: "client" });
  const [newClaim, setNewClaim] = useState({ claim_number: "", project_id: "", claim_period_start: "", claim_period_end: "", contract_value: "0", this_claim_amount: "0", retention_pct: "10" });

  const { departments } = useFinanceDepartments();

  const {
    data: financeData,
    warnings: sourceWarnings,
    error: loadError,
    isLoading: loading,
    refetch: loadData,
  } = useApiQueries(
    {
      projects: () => getInternalProjects(),
      summaries: () => getFinanceProjectSummaries({ department_id: departmentId || undefined }),
      costCodes: () => getFinanceCostCodes({ department_id: departmentId || undefined }),
      variations: () => getFinanceVariations({ department_id: departmentId || undefined }),
      claims: () => getFinanceProgressClaims({ department_id: departmentId || undefined }),
      budgets: () => getFinanceBudgets({ department_id: departmentId || undefined }),
      departmentPnl: () => getFinanceDepartmentPnl(),
      bankAllocation: () => getBankStatementAllocationSummary(),
    },
    [departmentId],
    {
      criticalKeys: ["summaries"],
      labels: {
        projects: "Project register",
        summaries: "Project financial summaries",
        costCodes: "Cost codes",
        variations: "Variation register",
        claims: "Progress claims",
        budgets: "Budgets",
        departmentPnl: "Department P&L",
        bankAllocation: "Bank statement allocation",
      },
    }
  );

  const projects = useMemo(() => financeData.projects?.data || [], [financeData.projects]);
  const projectSummaries = useMemo(() => financeData.summaries?.data || [], [financeData.summaries]);
  const costCodes = useMemo(() => financeData.costCodes?.data || [], [financeData.costCodes]);
  const variations = useMemo(() => financeData.variations?.data || [], [financeData.variations]);
  const claims = useMemo(() => financeData.claims?.data || [], [financeData.claims]);
  const budgets = useMemo(() => financeData.budgets?.data || [], [financeData.budgets]);
  const departmentPnl = useMemo(() => financeData.departmentPnl?.data || null, [financeData.departmentPnl]);
  // Bank statement money out that isn't tagged to any project yet (mostly cash
  // withdrawals) - costs and margins below are incomplete until it is.
  const unassignedBankOut = useMemo(() => {
    const rows: RecordData[] = financeData.bankAllocation?.data?.by_project || [];
    return Number(rows.find((r) => !r.project_id)?.money_out || 0);
  }, [financeData.bankAllocation]);

  useLiveTable("finance.budgets", () => void loadData());
  const error = loadError ? loadFailureMessage(loadError) : null;

  const loadProjectDetail = async (id: string) => {
    setSelectedProjectId(id);
    if (!id) {
      setProjectDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await getFinanceProjectDetail(id);
      setProjectDetail(res.data || null);
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to load project details."));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreateCostCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCostCode.code || !newCostCode.name) return;
    try {
      await createFinanceCostCode(newCostCode);
      setNotice("Cost code created successfully.");
      setShowCostCodeModal(false);
      setNewCostCode({ code: "", name: "", category: "materials" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to create cost code."));
    }
  };

  // The approval rules (QS review for site-originated variances, client
  // approval where required) live in the decision endpoint; its 409 detail
  // is shown as-is so the reason a variation can't be approved yet is visible.
  const handleVariationDecision = async (variation: RecordData, decision: "approve" | "reject") => {
    let reason: string | undefined;
    if (decision === "reject") {
      reason = window.prompt(`Reason for rejecting ${variation.variation_number || "this variation"} (required):`)?.trim() || undefined;
      if (!reason) return;
    } else if (!window.confirm(`Approve ${variation.variation_number || "this variation"}? Its cost and time impact will be added to the project.`)) {
      return;
    }
    try {
      await decideFinanceVariation(String(variation.id), decision, reason);
      setNotice(decision === "approve" ? "Variation approved." : "Variation rejected.");
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, `Failed to ${decision} variation.`));
    }
  };

  const handleCreateVariation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVariation.project_id || !newVariation.title) return;
    try {
      await createFinanceVariation({
        ...newVariation,
        cost_impact: Number(newVariation.cost_impact),
        time_impact_days: Number(newVariation.time_impact_days)
      });
      setNotice("Variation submitted successfully.");
      setShowVariationModal(false);
      setNewVariation({ variation_number: "", project_id: "", title: "", description: "", cost_impact: "0", time_impact_days: "0", initiated_by: "client" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to submit variation."));
    }
  };

  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClaim.project_id || !newClaim.claim_number) return;
    try {
      await createFinanceProgressClaim({
        ...newClaim,
        contract_value: Number(newClaim.contract_value),
        this_claim_amount: Number(newClaim.this_claim_amount),
        retention_pct: Number(newClaim.retention_pct),
      });
      setNotice("Progress claim submitted successfully.");
      setShowClaimModal(false);
      setNewClaim({ claim_number: "", project_id: "", claim_period_start: "", claim_period_end: "", contract_value: "0", this_claim_amount: "0", retention_pct: "10" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to submit progress claim."));
    }
  };

  const handleCertifyClaim = async (claimId: string) => {
    try {
      const res = await certifyFinanceProgressClaim(claimId);
      const vat = res.data?.vat_amount;
      setNotice(vat ? `Claim certified. VAT accrued: ${money(vat)}.` : "Claim certified.");
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to certify claim."));
    }
  };

  const handleRecordFiscalInvoice = async (claimId: string) => {
    const fiscalInvoiceNumber = window.prompt("Fiscal invoice number issued by your fiscal device for this claim:");
    if (!fiscalInvoiceNumber) return;
    try {
      await recordProgressClaimFiscalInvoice(claimId, fiscalInvoiceNumber);
      setNotice("Fiscal invoice recorded.");
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to record fiscal invoice."));
    }
  };

  // Aggregated KPIs
  const operationalTabs: FinanceTab[] = ["banking", "cash-accounts", "cashbook"];

  const kpis = useMemo(() => {
    let contractTotal = 0;
    let certifiedTotal = 0;
    let collectedTotal = 0;
    let committedTotal = 0;
    let actualTotal = 0;

    projectSummaries.forEach(p => {
      contractTotal += Number(p.contract_value || 0) + Number(p.approved_variations || 0);
      certifiedTotal += Number(p.certified_to_date || 0);
      collectedTotal += Number(p.cash_collected || 0);
      committedTotal += Number(p.committed_cost || 0);
      actualTotal += Number(p.actual_cost_to_date || 0);
    });

    const outstandingAR = certifiedTotal - collectedTotal;
    const forecastEAC = actualTotal + committedTotal;
    const marginAmount = contractTotal - forecastEAC;
    const marginPct = contractTotal > 0 ? (marginAmount / contractTotal) * 100 : 0;

    return {
      contractTotal,
      certifiedTotal,
      collectedTotal,
      committedTotal,
      actualTotal,
      outstandingAR,
      marginPct
    };
  }, [projectSummaries]);

  // Claims grouped by project, newest claim first inside each; projects
  // with claims still awaiting certification float to the top.
  const claimGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; rows: RecordData[]; claimed: number; certified: number; retention: number; pending: number }>();
    for (const c of claims) {
      const key = String(c.project_id || "none");
      const g = map.get(key) || { key, name: String(c.project_name || "No project"), rows: [], claimed: 0, certified: 0, retention: 0, pending: 0 };
      g.rows.push(c);
      g.claimed += Number(c.this_claim_amount || 0);
      g.certified += Number(c.certified_amount || 0);
      g.retention += Number(c.retention_amount || 0);
      if (c.status === "submitted") g.pending += 1;
      map.set(key, g);
    }
    const groups = Array.from(map.values());
    groups.forEach((g) => g.rows.sort((a, b) => String(b.claim_period_end || b.created_at || "").localeCompare(String(a.claim_period_end || a.created_at || ""))));
    return groups.sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  }, [claims]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Top Banner Notice */}
      {notice && (
        <div className="bg-ink-light border border-signal/20 px-4 py-3 rounded flex items-center justify-between text-paper text-sm">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="font-semibold">Finance data could not be loaded.</p>
            <p className="mt-1 text-red-100/80">{error}</p>
          </div>
        </div>
      )}
      {sourceWarnings.length > 0 && (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {sourceWarnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{warning}</p>
            </div>
          ))}
        </div>
      )}

      <DashboardPageHeader
        title={FINANCE_TAB_LABELS[activeTab]}
        subtitle="SNC authoritative financial ledger and budget controls."
        className="items-center"
        actions={
          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full" data-tour="finance-title">
            <button
              onClick={financeTour.openTour}
              className="text-slate hover:text-paper transition-colors"
              title="Replay Finance tour"
              aria-label="Replay Finance tour"
            >
              <CircleHelp className="w-5 h-5" />
            </button>
            <div className="flex items-center border border-ink-mid rounded-sm overflow-x-auto max-w-full whitespace-nowrap font-mono text-[11px] uppercase tracking-wider" data-tour="finance-departments">
              <button
                onClick={() => setDepartmentId("")}
                className={`px-3 py-2 transition-colors ${departmentId === "" ? "bg-signal text-ink font-semibold" : "text-slate hover:text-paper"}`}
              >
                Consolidated
              </button>
              {departments.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDepartmentId(d.id)}
                  className={`px-3 py-2 border-l border-ink-mid transition-colors ${departmentId === d.id ? "bg-signal text-ink font-semibold" : "text-slate hover:text-paper"}`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            {QUICK_ENTRY_TABS.includes(activeTab) && (
              <div className="relative" ref={quickEntryRef}>
                <button
                  onClick={() => setQuickEntryOpen((v) => !v)}
                  aria-expanded={quickEntryOpen}
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                    quickEntryOpen ? "bg-ink-mid border-signal/60 text-paper" : "border-ink-mid text-slate-light hover:text-paper hover:border-signal/40"
                  }`}
                >
                  <PanelRightOpen className="h-4 w-4" />
                  <span>Project quick entry</span>
                  {selectedProjectId && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${quickEntryOpen ? "rotate-180" : ""}`} />
                </button>
                {quickEntryOpen && (
                  <div className="absolute right-0 top-full mt-2 z-40 w-[min(460px,calc(100vw-2rem))] max-h-[calc(100vh-140px)] overflow-y-auto rounded-lg shadow-[0_24px_48px_-12px_rgba(0,0,0,0.7)] animate-in fade-in slide-in-from-top-1 duration-fast">
                    <ProjectFinancialsWorkspace
                      projects={projects}
                      budgets={budgets}
                      selectedProjectId={selectedProjectId}
                      onSelectProject={(id) => void loadProjectDetail(id)}
                      projectDetail={projectDetail}
                      detailLoading={detailLoading}
                      onDataChanged={async () => {
                        await loadData();
                        if (selectedProjectId) await loadProjectDetail(selectedProjectId);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => router.push(activeTab === "data-room" ? TAB_ROUTES.overview : TAB_ROUTES["data-room"])}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-sm text-xs font-mono uppercase tracking-wider transition-colors border ${
                activeTab === "data-room"
                  ? "bg-signal text-ink border-signal font-semibold"
                  : "border-signal/40 bg-signal/10 text-signal hover:bg-signal/20"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>SNC Data Room</span>
            </button>
            {activeTab === "cost-codes" && (
              <button
                onClick={() => setShowCostCodeModal(true)}
                className="flex items-center space-x-2 bg-signal text-ink font-medium px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>New Cost Code</span>
              </button>
            )}
            {activeTab === "variations" && (
              <button
                onClick={() => setShowVariationModal(true)}
                className="flex items-center space-x-2 bg-signal text-ink font-medium px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Record Variation</span>
              </button>
            )}
            {activeTab === "progress-claims" && (
              <button
                onClick={() => setShowClaimModal(true)}
                className="flex items-center space-x-2 bg-signal text-ink font-medium px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>New Claim</span>
              </button>
            )}
          </div>
        }
      />

      {/* Portfolio KPI strip - only on Project Financials, where these
          ledger totals are what the page is about. Other pages carry their
          own page-specific summary (or none). */}
      {activeTab === "project-financials" && (
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-4" data-tour="finance-kpis">
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Total Contract Value</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.contractTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Certified Revenue</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.certifiedTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Cash Collected</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.collectedTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Outstanding AR</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1 text-amber-400">{money(kpis.outstandingAR)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Committed Costs</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.committedTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Actual Costs</p>
          <p className="text-lg font-semibold text-paper tracking-tight mt-1">{money(kpis.actualTotal)}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)]">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Forecast Margin %</p>
          <div className="flex items-center space-x-2 mt-1">
            <span className={`text-lg font-semibold tracking-tight ${kpis.marginPct >= 15 ? 'text-emerald-400' : kpis.marginPct >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
              {percent(kpis.marginPct)}
            </span>
            {kpis.marginPct >= 15 ? (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
          </div>
        </div>
      </div>
      )}

      {/* Tab Panels */}
      {activeTab === "overview" ? (
        <FinanceOverviewDashboard projectSummaries={projectSummaries} departmentId={departmentId} unassignedBankOut={unassignedBankOut} />
      ) : activeTab === "data-room" ? (
        <DataRoomPanel />
      ) : activeTab === "bank-review" ? (
        <BankStatementReviewPanel projects={projects} />
      ) : activeTab === "payroll" ? (
        <PayrollPanel projects={projects} departmentId={departmentId} />
      ) : activeTab === "supplier-payments" ? (
        <SupplierPaymentsPanel />
      ) : (
        <div className="space-y-6">
          {operationalTabs.includes(activeTab) && (
            <FinanceOperationsPanel tab={activeTab as "banking" | "cash-accounts" | "cashbook"} projects={projects} departmentId={departmentId} />
          )}

          {activeTab === "transfers" && (
            <DepartmentTransfersPanel mode="transfers" departments={departments} projects={projects} />
          )}

          {activeTab === "department-pnl" && (
            <DepartmentTransfersPanel mode="pnl" departments={departments} projects={projects} departmentPnl={departmentPnl} />
          )}

          {activeTab === "statutory" && <StatutoryPanel />}

          {activeTab === "vendor-payments" && <VendorPaymentsPanel />}

          {activeTab === "client-payments" && <ClientPaymentsPanel />}

          {activeTab === "historical-entry" && <HistoricalEntryPanel />}

          {activeTab === "financial-statements" && <FinancialStatementsPanel />}

          {activeTab === "general-ledger" && <GeneralLedgerPanel />}

          {activeTab === "cash-forecast" && <CashForecastPanel />}

          {activeTab === "ai-assistant" && <FinanceAssistantPanel />}

          {activeTab === "management-accounts" && <ManagementAccountsPanel />}

          {activeTab === "project-portfolio" && <ProjectPortfolioPanel />}

          {activeTab === "audit-workspace" && <AuditWorkspacePanel />}

          {activeTab === "project-financials" && (
            <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex justify-between items-center">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Active Project Ledgers</span>
                <span className="text-[11px] text-slate">Click a project to see and attribute its money</span>
              </div>
              {unassignedBankOut > 0 && (
                <div className="px-4 py-3 border-b border-ink-mid bg-amber-950/20 text-xs text-amber-200">
                  {money(unassignedBankOut)} of bank statement money out isn&apos;t assigned to a project yet (mostly cash withdrawals), so actual costs and margins here are incomplete.{" "}
                  <button type="button" onClick={() => router.push(TAB_ROUTES["bank-review"])} className="underline hover:text-paper">Assign it in Bank Statement Review</button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">Project</th>
                      <th className="p-4 text-right">Contract Value</th>
                      <th className="p-4 text-right">Collected</th>
                      <th className="p-4 text-right" title="Money in / out on bank statement lines tagged to this project">Bank In</th>
                      <th className="p-4 text-right" title="Money in / out on bank statement lines tagged to this project">Bank Out</th>
                      <th className="p-4 text-right">Actual Cost</th>
                      <th className="p-4 text-right">Committed</th>
                      <th className="p-4 text-right">EAC</th>
                      <th className="p-4 text-right">Forecast Margin</th>
                      <th className="p-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {projectSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-4 text-center text-slate">No project financials registered.</td>
                      </tr>
                    ) : (
                      projectSummaries.map((p) => {
                        const totalRev = Number(p.contract_value || 0) + Number(p.approved_variations || 0);
                        const eac = Number(p.actual_cost_to_date || 0) + Number(p.committed_cost || 0);
                        const margin = totalRev - eac;
                        const marginPct = totalRev > 0 ? (margin / totalRev) * 100 : 0;
                        const isSelected = selectedProjectId === p.project_id;

                        return (
                          <tr
                            key={p.project_id}
                            onClick={() => { setMoneyProjectId(p.project_id); void loadProjectDetail(p.project_id); }}
                            title="Open this project's money"
                            className={`cursor-pointer hover:bg-ink-mid/30 transition-colors ${isSelected ? 'bg-ink-mid/20 border-l-2 border-l-signal' : ''}`}
                          >
                            <td className="p-4 font-medium text-paper">
                              {p.project_name || p.project_code}
                              {!p.department_id && (
                                <span className="ml-2 px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-mono border border-amber-500/30 bg-amber-950/20 text-amber-300 align-middle">
                                  Unassigned
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right text-paper">{money(totalRev)}</td>
                            <td className="p-4 text-right text-paper">{money(p.cash_collected)}</td>
                            <td className="p-4 text-right text-emerald-300/80">{Number(p.bank_in) ? money(p.bank_in) : "-"}</td>
                            <td className="p-4 text-right text-red-300/80">{Number(p.bank_out) ? money(p.bank_out) : "-"}</td>
                            <td className="p-4 text-right text-paper">{money(p.actual_cost_to_date)}</td>
                            <td className="p-4 text-right text-slate-light">{money(p.committed_cost)}</td>
                            <td className="p-4 text-right text-paper">{money(eac)}</td>
                            <td className="p-4 text-right">
                              <span className={marginPct >= 15 ? 'text-emerald-400' : marginPct >= 5 ? 'text-amber-400' : 'text-red-400'}>
                                {percent(marginPct)}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-wider font-mono border ${statusClass(p.project_status || 'active')}`}>
                                {p.project_status || 'active'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "cost-codes" && <CostCodesByProjectPanel departmentId={departmentId} refreshKey={costCodes.length} />}

          {activeTab === "variations" && (
            <div className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-mid bg-ink/30">
                <span className="font-mono text-xs tracking-wider uppercase text-slate">Variation Register (Change Orders)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink-light">
                      <th className="p-4">VO #</th>
                      <th className="p-4">Project</th>
                      <th className="p-4">Title</th>
                      <th className="p-4 text-right">Cost Impact</th>
                      <th className="p-4 text-right">Time (Days)</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {variations.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-slate">No variations recorded.</td>
                      </tr>
                    ) : (
                      variations.map((v) => (
                        <tr key={v.id} className="hover:bg-ink-mid/10">
                          <td className="p-4 font-mono text-paper font-medium">{v.variation_number}</td>
                          <td className="p-4 text-slate-light">{v.project_name || v.project_id}</td>
                          <td className="p-4 text-paper">{v.title}</td>
                          <td className={`p-4 text-right font-medium ${Number(v.cost_impact) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {money(v.cost_impact)}
                          </td>
                          <td className="p-4 text-right text-paper">{v.time_impact_days}</td>
                          <td className="p-4">
                            <span className={`border px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider ${statusClass(v.status)}`}>
                              {v.status}
                            </span>
                          </td>
                          <td className="p-4 text-right whitespace-nowrap">
                            {["pending", "submitted"].includes(String(v.status)) ? (
                              <div className="inline-flex gap-1.5">
                                <button onClick={() => void handleVariationDecision(v, "approve")} className="border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-sm text-[11px] hover:bg-emerald-950/30">Approve</button>
                                <button onClick={() => void handleVariationDecision(v, "reject")} className="border border-red-500/40 text-red-300 px-2 py-0.5 rounded-sm text-[11px] hover:bg-red-950/30">Reject</button>
                              </div>
                            ) : <span className="text-slate text-xs">—</span>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "progress-claims" && (
            <div className="space-y-3">
              {claimGroups.length === 0 ? (
                <div className="bg-ink-light border border-ink-mid rounded-lg p-6 text-center text-sm text-slate">No progress claims recorded.</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-light">{claimGroups.length} projects · {claims.length} claims</span>
                    <button onClick={() => setClaimGroupsOpen(Object.fromEntries(claimGroups.map((g) => [g.key, true])))} className="text-signal hover:underline ml-auto">Expand all</button>
                    <button onClick={() => setClaimGroupsOpen(Object.fromEntries(claimGroups.map((g) => [g.key, false])))} className="text-signal hover:underline">Collapse all</button>
                  </div>
                  {claimGroups.map((g) => {
                    const open = claimGroupsOpen[g.key] ?? g.pending > 0;
                    return (
                      <section key={g.key} className="bg-ink-light border border-ink-mid rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] overflow-hidden">
                        <button onClick={() => setClaimGroupsOpen((o) => ({ ...o, [g.key]: !open }))} className="w-full px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-left bg-ink/30 hover:bg-ink-mid/20">
                          {open ? <ChevronDown className="h-4 w-4 text-slate" /> : <ChevronRight className="h-4 w-4 text-slate" />}
                          <FolderKanban className="h-4 w-4 text-signal" />
                          <span className="text-paper font-medium flex-1 min-w-[180px]">{g.name}</span>
                          <span className="text-[11px] text-slate">{g.rows.length} claim{g.rows.length === 1 ? "" : "s"}</span>
                          {g.pending > 0 && <span className="text-[11px] text-sky-300">{g.pending} awaiting certification</span>}
                          <span className="text-xs text-slate-light">Claimed <span className="text-paper tabular-nums">{money(g.claimed)}</span></span>
                          <span className="text-xs text-slate-light">Certified <span className="text-emerald-400 tabular-nums">{money(g.certified)}</span></span>
                          <span className="text-xs text-slate-light">Retention <span className="text-amber-400 tabular-nums">{money(g.retention)}</span></span>
                        </button>
                        {open && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-sm">
                              <thead>
                                <tr className="border-y border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider">
                                  <th className="px-4 py-2">Claim #</th>
                                  <th className="px-4 py-2">Period</th>
                                  <th className="px-4 py-2 text-right">Claim Amount</th>
                                  <th className="px-4 py-2 text-right">Retention Held</th>
                                  <th className="px-4 py-2 text-right">Net Claim</th>
                                  <th className="px-4 py-2 text-right">Certified</th>
                                  <th className="px-4 py-2">Status</th>
                                  <th className="px-4 py-2">Fiscal Invoice #</th>
                                  <th className="px-4 py-2"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-ink-mid">
                                {g.rows.map((c) => (
                                  <tr key={c.id} className="hover:bg-ink-mid/10">
                                    <td className="px-4 py-2 font-mono text-paper font-medium">{c.claim_number}</td>
                                    <td className="px-4 py-2 text-slate-light text-xs whitespace-nowrap">{c.claim_period_start ? `${String(c.claim_period_start).slice(0, 10)} → ${String(c.claim_period_end || "").slice(0, 10)}` : "—"}</td>
                                    <td className="px-4 py-2 text-right text-paper">{money(c.this_claim_amount)}</td>
                                    <td className="px-4 py-2 text-right text-amber-400">{money(c.retention_amount)}</td>
                                    <td className="px-4 py-2 text-right text-paper font-medium">{money(c.net_claim_amount)}</td>
                                    <td className="px-4 py-2 text-right text-emerald-400">{c.certified_amount ? money(c.certified_amount) : "—"}</td>
                                    <td className="px-4 py-2">
                                      <span className={`border px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider ${statusClass(c.status)}`}>{c.status}</span>
                                    </td>
                                    <td className="px-4 py-2 text-slate-light font-mono text-xs">{c.fiscal_invoice_number || "—"}</td>
                                    <td className="px-4 py-2 text-right whitespace-nowrap">
                                      {c.status === "submitted" && (
                                        <button onClick={() => void handleCertifyClaim(c.id)} className="text-xs text-signal hover:underline">Certify</button>
                                      )}
                                      {c.status === "certified" && (
                                        <button onClick={() => void handleRecordFiscalInvoice(c.id)} className="text-xs text-signal hover:underline">Record Fiscal Invoice</button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {activeTab === "earned-value" && <EarnedValuePanel />}

          {activeTab === "close-out" && <FinalAccountPanel />}

          {activeTab === "budgets" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-ink-mid">
                <button onClick={() => setBudgetsSubView("project")} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px ${budgetsSubView === "project" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}>Project Budgets</button>
                <button onClick={() => setBudgetsSubView("company")} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px ${budgetsSubView === "company" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}>Company &amp; Department</button>
              </div>

              {budgetsSubView === "project" && <ProjectBudgetsPanel budgets={budgets} onChanged={() => loadData()} />}

              {budgetsSubView === "company" && <CompanyBudgetPanel />}
            </div>
          )}

        </div>
      )}

      {moneyProjectId && (
        <ProjectMoneyModal
          projectId={moneyProjectId}
          projects={projects}
          onClose={() => setMoneyProjectId("")}
          onChanged={() => loadData()}
          claimsAndBudget={
            <ProjectFinancialsWorkspace
              projects={projects}
              budgets={budgets}
              selectedProjectId={moneyProjectId}
              onSelectProject={(id) => { setMoneyProjectId(id); void loadProjectDetail(id); }}
              projectDetail={projectDetail}
              detailLoading={detailLoading}
              onDataChanged={async () => {
                await loadData();
                await loadProjectDetail(moneyProjectId);
              }}
            />
          }
        />
      )}

      {/* Cost Code Modal */}
      {showCostCodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Create Cost Code</span>
              <button onClick={() => setShowCostCodeModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCostCode} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 03-100"
                  value={newCostCode.code}
                  onChange={(e) => setNewCostCode({ ...newCostCode, code: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Concrete Materials"
                  value={newCostCode.name}
                  onChange={(e) => setNewCostCode({ ...newCostCode, name: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Category</label>
                <select
                  value={newCostCode.category}
                  onChange={(e) => setNewCostCode({ ...newCostCode, category: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="labour">Labour</option>
                  <option value="equipment">Equipment</option>
                  <option value="materials">Materials</option>
                  <option value="subcontract">Subcontract</option>
                  <option value="overhead">Overhead</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowCostCodeModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Variation Modal */}
      {showVariationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-lg p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Record Variation Order</span>
              <button onClick={() => setShowVariationModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVariation} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">VO Number</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. VO-001"
                    value={newVariation.variation_number}
                    onChange={(e) => setNewVariation({ ...newVariation, variation_number: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Project</label>
                  <select
                    required
                    value={newVariation.project_id}
                    onChange={(e) => setNewVariation({ ...newVariation, project_id: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="">Select Project</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Title</label>
                <input
                  type="text"
                  required
                  placeholder="Additional earthworks scope"
                  value={newVariation.title}
                  onChange={(e) => setNewVariation({ ...newVariation, title: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Description</label>
                <textarea
                  placeholder="Full scope and design modifications..."
                  value={newVariation.description}
                  onChange={(e) => setNewVariation({ ...newVariation, description: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50 h-20"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Cost Impact ($)</label>
                  <input
                    type="number"
                    value={newVariation.cost_impact}
                    onChange={(e) => setNewVariation({ ...newVariation, cost_impact: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Time Impact (Days)</label>
                  <input
                    type="number"
                    value={newVariation.time_impact_days}
                    onChange={(e) => setNewVariation({ ...newVariation, time_impact_days: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Initiated By</label>
                  <select
                    value={newVariation.initiated_by}
                    onChange={(e) => setNewVariation({ ...newVariation, initiated_by: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="client">Client</option>
                    <option value="contractor">Contractor</option>
                    <option value="designer">Designer</option>
                    <option value="statutory">Statutory</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowVariationModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Submit VO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Progress Claim Modal */}
      {showClaimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-lg p-6 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.35),0_14px_28px_-18px_rgba(0,0,0,0.55)] space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Submit Progress Claim</span>
              <button onClick={() => setShowClaimModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateClaim} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Claim Number</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. PC-001"
                    value={newClaim.claim_number}
                    onChange={(e) => setNewClaim({ ...newClaim, claim_number: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Project</label>
                  <select
                    required
                    value={newClaim.project_id}
                    onChange={(e) => setNewClaim({ ...newClaim, project_id: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="">Select Project</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Period Start</label>
                  <input
                    type="date"
                    required
                    value={newClaim.claim_period_start}
                    onChange={(e) => setNewClaim({ ...newClaim, claim_period_start: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Period End</label>
                  <input
                    type="date"
                    required
                    value={newClaim.claim_period_end}
                    onChange={(e) => setNewClaim({ ...newClaim, claim_period_end: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Contract Value</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={newClaim.contract_value}
                    onChange={(e) => setNewClaim({ ...newClaim, contract_value: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Claim Amount</label>
                  <input
                    type="number" min="0.01" step="0.01" required
                    value={newClaim.this_claim_amount}
                    onChange={(e) => setNewClaim({ ...newClaim, this_claim_amount: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Retention %</label>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={newClaim.retention_pct}
                    onChange={(e) => setNewClaim({ ...newClaim, retention_pct: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowClaimModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Submit Claim
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModuleTour
        steps={FINANCE_TOUR_STEPS}
        open={financeTour.open}
        onClose={financeTour.closeTour}
        onComplete={financeTour.completeTour}
      />
    </div>
  );
}







