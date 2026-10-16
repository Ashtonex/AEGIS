"use client";

import { useMemo, useState } from "react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  ApiError,
  createExternalPlantHireAgreement,
  generateExternalPlantHireInvoice,
  getExternalPlantHireAgreements,
  getPlantRequests,
  recordExternalPlantHireSupplierInvoice,
  updateExternalPlantHireAgreement,
} from "@/lib/api";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  Building,
  CheckCircle2,
  DollarSign,
  FileCheck,
  FileSpreadsheet,
  HandCoins,
  Layers,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Truck,
  User,
  Wrench,
  X,
} from "lucide-react";

type RecordItem = Record<string, unknown> & { id: string };

function text(record: RecordItem, ...keys: string[]): string {
  for (const k of keys) {
    const v = record[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v);
  }
  return "";
}

function fmtMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(amount));
}

export default function CommercialHirePage() {
  return (
    <RBACGuard permission="fleet.external_hire.read">
      <CommercialHireDashboard />
    </RBACGuard>
  );
}

function CommercialHireDashboard() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "cross_hire" | "owned_fleet">("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<
    | { type: "new" }
    | { type: "invoice"; agreement: RecordItem }
    | { type: "supplier_invoice"; agreement: RecordItem }
    | null
  >(null);

  const { data, isLoading, refetch } = useApiQueries(
    {
      agreements: () => getExternalPlantHireAgreements(),
      requests: () => getPlantRequests(),
    },
    [],
    { criticalKeys: ["agreements"] }
  );

  useLiveTable("fleet.external_hire_agreements", () => void refetch());

  const agreements = useMemo(
    () => (Array.isArray(data.agreements?.data) ? data.agreements.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.agreements]
  );

  const plantRequests = useMemo(
    () => (Array.isArray(data.requests?.data) ? data.requests.data.filter((item): item is RecordItem => Boolean(item && typeof item === "object" && item.id)) : []),
    [data.requests]
  );

  const filtered = useMemo(() => {
    return agreements.filter((a) => {
      const matchSearch = [
        text(a, "hire_agreement_number"),
        text(a, "customer_name"),
        text(a, "supplier_name"),
        text(a, "sourced_asset_make_model"),
        text(a, "sourced_asset_category"),
        text(a, "invoice_instruction"),
      ]
        .join(" ")
        .toLowerCase();

      const matchStatus = statusFilter === "all" || text(a, "status") === statusFilter;

      const fType = text(a, "fulfillment_type") || "owned_fleet";
      const matchFulfillment =
        fulfillmentFilter === "all" ||
        (fulfillmentFilter === "cross_hire" && (fType === "cross_hire" || fType === "sub_lease")) ||
        (fulfillmentFilter === "owned_fleet" && fType === "owned_fleet");

      return matchStatus && matchFulfillment && matchSearch.includes(query.toLowerCase());
    });
  }, [agreements, query, statusFilter, fulfillmentFilter]);

  const kpis = useMemo(() => {
    const activeAgreements = agreements.filter((a) => ["active", "dispatched"].includes(text(a, "status"))).length;
    const crossHires = agreements.filter((a) => ["cross_hire", "sub_lease"].includes(text(a, "fulfillment_type")));
    const crossHireCount = crossHires.length;
    const totalRealizedMargin = crossHires.reduce((sum, a) => sum + (Number(a.realized_gross_profit) || 0), 0);
    const totalProjectedMargin = crossHires.reduce((sum, a) => sum + (Number(a.projected_gross_profit) || 0), 0);
    const totalSupplierPayable = crossHires.reduce((sum, a) => sum + (Number(a.supplier_payable_amount) || 0), 0);
    const invoicePending = agreements.filter((a) => ["off_hire_requested", "returned", "invoice_instruction"].includes(text(a, "status"))).length;

    return {
      activeAgreements,
      crossHireCount,
      totalRealizedMargin,
      totalProjectedMargin,
      totalSupplierPayable,
      invoicePending,
    };
  }, [agreements]);

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <DashboardPageHeader
          eyebrow={{ label: "Assets / Plant & Equipment", icon: Truck }}
          title="Commercial Hire & Revenue"
          subtitle="Client hire agreements, back-to-back cross-hire sub-leases (Party A -> Company -> Party B), rate spreads, billing, and supplier payables."
          actions={
            <>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isLoading}
                className="inline-flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2 text-xs font-medium text-paper hover:border-slate disabled:opacity-50"
              >
                <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh
              </button>
              <button
                type="button"
                onClick={() => setModal({ type: "new" })}
                className="inline-flex items-center gap-2 bg-signal px-3 py-2 text-xs font-semibold text-ink hover:bg-signal/90"
              >
                <Plus size={14} /> New Hire / Cross-Hire Deal
              </button>
            </>
          }
        />

        {notice && (
          <div className="mb-5 flex items-start gap-3 border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <p>{notice}</p>
          </div>
        )}

        {/* Operating Model KPI Metrics */}
        <section className="mb-6 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-5">
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Active Commercial Hires</span>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{kpis.activeAgreements}</p>
            <p className="mt-1 text-[11px] text-slate-light">Dispatched or on-site</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Cross-Hire Sub-Leases</span>
            <p className="mt-2 text-2xl font-bold text-purple-300">{kpis.crossHireCount}</p>
            <p className="mt-1 text-[11px] text-purple-400">Sourced A → Leased B deals</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Realized Gross Margin</span>
            <p className="mt-2 text-2xl font-bold text-emerald-400">{fmtMoney(kpis.totalRealizedMargin)}</p>
            <p className="mt-1 text-[11px] text-slate-light">Spread earned on billed hours</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Projected Deal Profit</span>
            <p className="mt-2 text-2xl font-bold text-blue-300">{fmtMoney(kpis.totalProjectedMargin)}</p>
            <p className="mt-1 text-[11px] text-slate-light">Estimated total contract spread</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Supplier Payables (A)</span>
            <p className="mt-2 text-2xl font-bold text-amber-300">{fmtMoney(kpis.totalSupplierPayable)}</p>
            <p className="mt-1 text-[11px] text-slate-light">Owed to sourcing plant owners</p>
          </div>
        </section>

        {/* Filter Controls & Model Tabs */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFulfillmentFilter("all")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                fulfillmentFilter === "all" ? "border-b-2 border-signal font-semibold text-paper" : "text-slate hover:text-paper"
              }`}
            >
              All Agreements ({agreements.length})
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentFilter("cross_hire")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                fulfillmentFilter === "cross_hire" ? "border-b-2 border-purple-400 font-semibold text-purple-300" : "text-slate hover:text-paper"
              }`}
            >
              <ArrowRightLeft size={13} /> Cross-Hire & Sub-Leases ({agreements.filter((a) => ["cross_hire", "sub_lease"].includes(text(a, "fulfillment_type"))).length})
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentFilter("owned_fleet")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                fulfillmentFilter === "owned_fleet" ? "border-b-2 border-blue-400 font-semibold text-blue-300" : "text-slate hover:text-paper"
              }`}
            >
              <Truck size={13} /> Company-Owned Fleet ({agreements.filter((a) => !["cross_hire", "sub_lease"].includes(text(a, "fulfillment_type"))).length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate" size={14} />
              <input
                type="text"
                placeholder="Search ref, supplier, client, asset..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-72 border border-ink-mid bg-ink-light py-2 pl-9 pr-3 text-xs text-paper placeholder-slate focus:border-signal focus:outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper focus:border-signal focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="enquiry">Enquiry</option>
              <option value="quoted">Quoted</option>
              <option value="agreement_signed">Agreement Signed</option>
              <option value="deposit_pending">Deposit Pending</option>
              <option value="active">Active On-Site</option>
              <option value="off_hire_requested">Off-Hire Requested</option>
              <option value="returned">Returned</option>
              <option value="invoice_instruction">Invoice Instruction</option>
              <option value="debtor_follow_up">Debtor Follow-Up</option>
              <option value="closed">Closed / Paid</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="No commercial hire agreements found"
            description="Create commercial hire contracts or back-to-back cross-hire sub-leases with automatic margin tracking."
          />
        ) : (
          <div className="border border-ink-mid bg-ink overflow-x-auto">
            <OperationalTable className="min-w-[1300px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Deal / Model</TableHead>
                  <TableHead>Party A (Sourced Owner)</TableHead>
                  <TableHead>Party B (Client Hire)</TableHead>
                  <TableHead>Machine / Asset</TableHead>
                  <TableHead>Unit Spread (Margin)</TableHead>
                  <TableHead>Gross Margin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((agr) => {
                  const rateCard = (agr.rate_card && typeof agr.rate_card === "object" ? agr.rate_card : {}) as Record<string, unknown>;
                  const hourlyRate = Number(rateCard.hourly_rate ?? rateCard.rate ?? 0);
                  const sourcingRate = Number(agr.sourcing_rate ?? 0);
                  const spread = Number(agr.unit_spread ?? (hourlyRate - sourcingRate));
                  const spreadPct = Number(agr.unit_spread_percentage ?? (hourlyRate > 0 ? (spread / hourlyRate) * 100 : 0));
                  const isCrossHire = ["cross_hire", "sub_lease"].includes(text(agr, "fulfillment_type"));
                  const st = text(agr, "status");
                  const realizedProfit = Number(agr.realized_gross_profit ?? 0);
                  const projectedProfit = Number(agr.projected_gross_profit ?? 0);

                  return (
                    <TableRow key={agr.id}>
                      <TableCell>
                        <p className="font-semibold text-paper">{text(agr, "hire_agreement_number") || agr.id.slice(0, 8)}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {isCrossHire ? (
                            <span className="inline-flex items-center gap-1 border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-purple-300">
                              <ArrowRightLeft size={10} /> Sub-Lease (A → B)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-blue-300">
                              <Truck size={10} /> Owned Fleet
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        {isCrossHire ? (
                          <div>
                            <p className="font-medium text-amber-200">{text(agr, "supplier_name") || "Third-Party Owner"}</p>
                            <p className="text-[11px] text-slate-light">
                              Cost: <span className="font-mono text-paper font-semibold">{fmtMoney(sourcingRate)}</span>/hr ({text(agr, "supplier_terms").replace(/_/g, " ")})
                            </p>
                            <p className="text-[10px] text-slate">
                              Payable: {fmtMoney(Number(agr.supplier_payable_amount ?? 0))} ({text(agr, "supplier_payment_status").replace(/_/g, " ")})
                            </p>
                          </div>
                        ) : (
                          <div className="text-slate-light text-xs italic">
                            Internal SNC Fleet
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <p className="font-medium text-paper">{text(agr, "customer_name") || "Walk-in Client"}</p>
                        <p className="text-[11px] text-slate-light">
                          Sell: <span className="font-mono text-emerald-300 font-semibold">{fmtMoney(hourlyRate)}</span>/hr ({text(agr, "hire_type").replace(/_/g, " ")})
                        </p>
                        <p className="text-[10px] text-slate">
                          Deposit: {fmtMoney(Number(agr.deposit_required ?? 0))}
                        </p>
                      </TableCell>

                      <TableCell>
                        {isCrossHire ? (
                          <div>
                            <p className="font-medium text-paper">{text(agr, "sourced_asset_make_model") || text(agr, "sourced_asset_category") || "Sourced Plant"}</p>
                            <p className="font-mono text-[10px] text-slate-light">
                              SN: {text(agr, "sourced_asset_reg_serial") || "N/A"} | Meter: {Number(agr.sourced_meter_start ?? 0)}h
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-xs text-paper">{text(agr, "required_asset_type") || "Company Unit"}</p>
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        {isCrossHire ? (
                          <div>
                            <span className="font-mono font-bold text-emerald-400">
                              +{fmtMoney(spread)}/hr
                            </span>
                            <p className="text-[10px] font-mono text-emerald-500">
                              {spreadPct.toFixed(1)}% margin
                            </p>
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-slate-light">100% Internal</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {isCrossHire ? (
                          <div>
                            <p className="font-mono text-xs font-bold text-paper">
                              {realizedProfit > 0 ? fmtMoney(realizedProfit) : fmtMoney(projectedProfit)}
                            </p>
                            <p className="text-[10px] text-slate-light">
                              {realizedProfit > 0 ? "Realized (Billed)" : "Projected"}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className="font-mono text-xs text-paper">{fmtMoney(Number(agr.invoiced_amount ?? 0))}</p>
                            <p className="text-[10px] text-slate-light">Invoiced Revenue</p>
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <span className="inline-flex border border-slate/40 bg-ink-light px-2 py-0.5 font-mono text-[10px] uppercase text-paper">
                          {st.replace(/_/g, " ")}
                        </span>
                        {text(agr, "invoice_instruction") && (
                          <p className="mt-1 font-mono text-[10px] text-emerald-400 truncate max-w-[130px]">
                            {text(agr, "invoice_instruction").split("|")[0]}
                          </p>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isCrossHire && (
                            <button
                              type="button"
                              onClick={() => setModal({ type: "supplier_invoice", agreement: agr })}
                              className="border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20"
                              title="Record or verify Supplier A cost invoice"
                            >
                              Supplier (A) Inv
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setModal({ type: "invoice", agreement: agr })}
                            className="border border-signal/60 bg-signal/10 px-2 py-1 text-[11px] text-signal hover:bg-signal/20"
                          >
                            Client (B) Inv
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </OperationalTable>
          </div>
        )}

        {/* Modal: New Hire Agreement */}
        {modal?.type === "new" && (
          <NewAgreementModal
            plantRequests={plantRequests}
            onClose={() => setModal(null)}
            onSuccess={() => {
              setModal(null);
              setNotice("Hire agreement created successfully.");
              void refetch();
            }}
          />
        )}

        {/* Modal: Generate Client Invoice */}
        {modal?.type === "invoice" && modal.agreement && (
          <GenerateInvoiceModal
            agreement={modal.agreement}
            onClose={() => setModal(null)}
            onSuccess={() => {
              setModal(null);
              setNotice("Draft commercial invoice generated and staged for billing.");
              void refetch();
            }}
          />
        )}

        {/* Modal: Supplier A Invoice & Reconciliation */}
        {modal?.type === "supplier_invoice" && modal.agreement && (
          <SupplierInvoiceModal
            agreement={modal.agreement}
            onClose={() => setModal(null)}
            onSuccess={() => {
              setModal(null);
              setNotice("Supplier invoice record updated successfully.");
              void refetch();
            }}
          />
        )}
      </div>
    </main>
  );
}

function NewAgreementModal({
  plantRequests,
  onClose,
  onSuccess,
}: {
  plantRequests: RecordItem[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [dealType, setDealType] = useState<"cross_hire" | "owned_fleet">("cross_hire");
  const [formData, setFormData] = useState({
    // Client (Party B) fields
    plant_request_id: plantRequests[0]?.id || "",
    customer_name: "",
    hire_agreement_number: `HA-${Date.now().toString().slice(-6)}`,
    hire_type: "wet_hire",
    hourly_rate: 1.5,
    deposit_required: 500,
    fuel_responsibility: "client",
    mobilisation_charge: 150,
    demobilisation_charge: 150,
    standing_time_rate: 0.75,
    overtime_rate: 2.0,

    // Sourcing (Party A) fields
    supplier_name: "",
    supplier_contact: "",
    supplier_agreement_number: `SA-${Date.now().toString().slice(-6)}`,
    sourcing_rate: 1.0,
    sourcing_rate_unit: "hourly",
    supplier_terms: "dry_hire",
    supplier_fuel_responsibility: "snc",
    supplier_deposit_paid: 300,
    supplier_mobilisation_cost: 100,
    supplier_demobilisation_cost: 100,
    supplier_standing_rate: 0.5,

    // Sourced Machine Details
    sourced_asset_category: "Excavator",
    sourced_asset_make_model: "CAT 320D",
    sourced_asset_reg_serial: "",
    sourced_meter_start: 0,
    projected_hours_or_units: 100,
  });

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live spread calculation
  const clientRate = Number(formData.hourly_rate || 0);
  const buyRate = dealType === "cross_hire" ? Number(formData.sourcing_rate || 0) : 0;
  const spreadPerUnit = clientRate - buyRate;
  const marginPct = clientRate > 0 ? (spreadPerUnit / clientRate) * 100 : 0;
  const estUnits = Number(formData.projected_hours_or_units || 0);
  const estClientRevenue = clientRate * estUnits + Number(formData.mobilisation_charge || 0) + Number(formData.demobilisation_charge || 0);
  const estSupplierCost = buyRate * estUnits + Number(formData.supplier_mobilisation_cost || 0) + Number(formData.supplier_demobilisation_cost || 0);
  const estGrossProfit = dealType === "cross_hire" ? estClientRevenue - estSupplierCost : estClientRevenue;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customer_name) {
      setErr("Customer name is required.");
      return;
    }
    if (dealType === "cross_hire" && !formData.supplier_name) {
      setErr("Supplier / Owner A name is required for cross-hire deals.");
      return;
    }
    if (dealType === "cross_hire" && buyRate >= clientRate) {
      setErr(`Sourcing cost ($${buyRate}) cannot be equal to or greater than client hire rate ($${clientRate}). This deal would lose money.`);
      return;
    }

    setSubmitting(true);
    setErr(null);

    try {
      await createExternalPlantHireAgreement({
        fulfillment_type: dealType,
        plant_request_id: formData.plant_request_id || undefined,
        customer_name: formData.customer_name,
        hire_agreement_number: formData.hire_agreement_number,
        hire_type: formData.hire_type,
        rate_card: { hourly_rate: clientRate },
        deposit_required: Number(formData.deposit_required),
        fuel_responsibility: formData.fuel_responsibility,
        mobilisation_charge: Number(formData.mobilisation_charge),
        demobilisation_charge: Number(formData.demobilisation_charge),
        standing_time_rate: Number(formData.standing_time_rate),
        overtime_rate: Number(formData.overtime_rate),
        status: "agreement_signed",

        // Cross-hire specific attributes
        supplier_name: dealType === "cross_hire" ? formData.supplier_name : undefined,
        supplier_contact: dealType === "cross_hire" ? formData.supplier_contact : undefined,
        supplier_agreement_number: dealType === "cross_hire" ? formData.supplier_agreement_number : undefined,
        sourcing_rate: buyRate,
        sourcing_rate_unit: formData.sourcing_rate_unit,
        supplier_terms: formData.supplier_terms,
        supplier_fuel_responsibility: formData.supplier_fuel_responsibility,
        supplier_deposit_paid: Number(formData.supplier_deposit_paid || 0),
        supplier_mobilisation_cost: Number(formData.supplier_mobilisation_cost || 0),
        supplier_demobilisation_cost: Number(formData.supplier_demobilisation_cost || 0),
        supplier_standing_rate: Number(formData.supplier_standing_rate || 0),
        sourced_asset_category: dealType === "cross_hire" ? formData.sourced_asset_category : undefined,
        sourced_asset_make_model: dealType === "cross_hire" ? formData.sourced_asset_make_model : undefined,
        sourced_asset_reg_serial: dealType === "cross_hire" ? formData.sourced_asset_reg_serial : undefined,
        sourced_meter_start: Number(formData.sourced_meter_start || 0),
        projected_hours_or_units: estUnits,
      });

      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to create hire agreement.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl border border-ink-mid bg-ink shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-paper">Create Plant Hire Deal</h2>
            <p className="text-[11px] text-slate-light">Configure direct company hire or back-to-back cross-hire sub-lease</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}

          {/* Deal Model Switcher */}
          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1.5">Operating Fulfillment Model</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDealType("cross_hire")}
                className={`flex items-start gap-3 border p-3 text-left transition-colors ${
                  dealType === "cross_hire"
                    ? "border-purple-400 bg-purple-500/10 text-paper"
                    : "border-ink-mid bg-ink-light text-slate hover:border-slate"
                }`}
              >
                <ArrowRightLeft className={`mt-0.5 shrink-0 ${dealType === "cross_hire" ? "text-purple-400" : "text-slate"}`} size={16} />
                <div>
                  <p className="text-xs font-semibold">Cross-Hire Sub-Lease (A → B)</p>
                  <p className="text-[10px] text-slate-light">Source from Owner A at Buy Rate, Lease to Client B at Sell Rate, retain spread.</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDealType("owned_fleet")}
                className={`flex items-start gap-3 border p-3 text-left transition-colors ${
                  dealType === "owned_fleet"
                    ? "border-blue-400 bg-blue-500/10 text-paper"
                    : "border-ink-mid bg-ink-light text-slate hover:border-slate"
                }`}
              >
                <Truck className={`mt-0.5 shrink-0 ${dealType === "owned_fleet" ? "text-blue-400" : "text-slate"}`} size={16} />
                <div>
                  <p className="text-xs font-semibold">Company-Owned Fleet</p>
                  <p className="text-[10px] text-slate-light">Dispatch an asset from existing internal company fleet.</p>
                </div>
              </button>
            </div>
          </div>

          {/* Cross-Hire Section 1: Party A (Supplier / Sourced Owner) */}
          {dealType === "cross_hire" && (
            <div className="border border-purple-500/30 bg-purple-500/5 p-3.5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-purple-300">
                <Building size={14} /> Party A: Sourcing Supplier / Equipment Owner
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Owner / Supplier Legal Name *</label>
                  <input
                    type="text"
                    value={formData.supplier_name}
                    onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs text-paper"
                    placeholder="e.g., Heavy Equipment Rentals Ltd"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Supplier Contact / Phone</label>
                  <input
                    type="text"
                    value={formData.supplier_contact}
                    onChange={(e) => setFormData({ ...formData, supplier_contact: e.target.value })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs text-paper"
                    placeholder="Contact person / phone"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Sourcing Cost Rate ($/hr) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.sourcing_rate}
                    onChange={(e) => setFormData({ ...formData, sourcing_rate: Number(e.target.value) })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs font-mono font-bold text-amber-300"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Supplier Terms</label>
                  <select
                    value={formData.supplier_terms}
                    onChange={(e) => setFormData({ ...formData, supplier_terms: e.target.value })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs text-paper"
                  >
                    <option value="dry_hire">Dry Hire (Machine Only)</option>
                    <option value="wet_hire">Wet Hire (With Operator/Fuel)</option>
                    <option value="dry_with_maintenance">Dry + Maintenance by Owner</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Supplier Deposit Paid ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.supplier_deposit_paid}
                    onChange={(e) => setFormData({ ...formData, supplier_deposit_paid: Number(e.target.value) })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs text-paper"
                  />
                </div>
              </div>

              {/* Sourced Machine Details */}
              <div className="pt-2 border-t border-purple-500/20 grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Asset Category</label>
                  <input
                    type="text"
                    value={formData.sourced_asset_category}
                    onChange={(e) => setFormData({ ...formData, sourced_asset_category: e.target.value })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs text-paper"
                    placeholder="Excavator, Grader, Crane"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Make & Model</label>
                  <input
                    type="text"
                    value={formData.sourced_asset_make_model}
                    onChange={(e) => setFormData({ ...formData, sourced_asset_make_model: e.target.value })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs text-paper"
                    placeholder="e.g. CAT 320D"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate mb-1">Reg / Serial Number</label>
                  <input
                    type="text"
                    value={formData.sourced_asset_reg_serial}
                    onChange={(e) => setFormData({ ...formData, sourced_asset_reg_serial: e.target.value })}
                    className="w-full border border-ink-mid bg-ink px-3 py-1.5 text-xs text-paper"
                    placeholder="Plate / Serial #"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Section 2: Party B (Client / Customer Details) */}
          <div className="border border-ink-mid bg-ink-light/50 p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-paper">
              <User size={14} className="text-signal" /> Party B: Client / Customer Details
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Customer / Client Name *</label>
                <input
                  type="text"
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
                  placeholder="Client legal entity"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Agreement Number</label>
                <input
                  type="text"
                  value={formData.hire_agreement_number}
                  onChange={(e) => setFormData({ ...formData, hire_agreement_number: e.target.value })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Client Hire Rate ($/hr) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.hourly_rate}
                  onChange={(e) => setFormData({ ...formData, hourly_rate: Number(e.target.value) })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs font-mono font-bold text-emerald-400"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Client Hire Mode</label>
                <select
                  value={formData.hire_type}
                  onChange={(e) => setFormData({ ...formData, hire_type: e.target.value })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
                >
                  <option value="wet_hire">Wet Hire (With Fuel/Operator)</option>
                  <option value="dry_hire">Dry Hire (Machine Only)</option>
                  <option value="hourly">Hourly Machine Meter</option>
                  <option value="daily">Daily Flat Rate</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Client Deposit Required ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.deposit_required}
                  onChange={(e) => setFormData({ ...formData, deposit_required: Number(e.target.value) })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Client Mobilisation ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.mobilisation_charge}
                  onChange={(e) => setFormData({ ...formData, mobilisation_charge: Number(e.target.value) })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Client Demobilisation ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.demobilisation_charge}
                  onChange={(e) => setFormData({ ...formData, demobilisation_charge: Number(e.target.value) })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-slate mb-1">Est. Working Hours</label>
                <input
                  type="number"
                  value={formData.projected_hours_or_units}
                  onChange={(e) => setFormData({ ...formData, projected_hours_or_units: Number(e.target.value) })}
                  className="w-full border border-ink-mid bg-ink-light px-3 py-1.5 text-xs text-paper"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Live Spread & Margin Calculator */}
          {dealType === "cross_hire" && (
            <div className="border border-emerald-500/30 bg-emerald-500/5 p-4 rounded-sm">
              <span className="font-mono text-[10px] uppercase text-emerald-400 font-bold tracking-wider">
                Live Sub-Lease Spread & Profit Calculator
              </span>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="border border-ink-mid bg-ink p-2">
                  <span className="text-[10px] text-slate-light block">Sourcing Cost (A)</span>
                  <span className="font-mono text-sm font-semibold text-amber-300">{fmtMoney(buyRate)}/hr</span>
                </div>
                <div className="border border-ink-mid bg-ink p-2">
                  <span className="text-[10px] text-slate-light block">Client Sell Rate (B)</span>
                  <span className="font-mono text-sm font-semibold text-emerald-300">{fmtMoney(clientRate)}/hr</span>
                </div>
                <div className="border border-ink-mid bg-ink p-2">
                  <span className="text-[10px] text-slate-light block">Company Spread</span>
                  <span className="font-mono text-sm font-bold text-emerald-400">+{fmtMoney(spreadPerUnit)}/hr</span>
                  <span className="text-[9px] text-emerald-500 block">({marginPct.toFixed(1)}% margin)</span>
                </div>
                <div className="border border-ink-mid bg-ink p-2">
                  <span className="text-[10px] text-slate-light block">Est. Deal Profit ({estUnits}h)</span>
                  <span className="font-mono text-sm font-bold text-signal">{fmtMoney(estGrossProfit)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
            >
              {submitting ? "Creating Deal..." : "Commit Hire Deal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GenerateInvoiceModal({
  agreement,
  onClose,
  onSuccess,
}: {
  agreement: RecordItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isCrossHire = ["cross_hire", "sub_lease"].includes(text(agreement, "fulfillment_type"));
  const rateCard = (agreement.rate_card && typeof agreement.rate_card === "object" ? agreement.rate_card : {}) as Record<string, unknown>;
  const hourlyRate = Number(rateCard.hourly_rate ?? rateCard.rate ?? 0);
  const sourcingRate = Number(agreement.sourcing_rate ?? 0);
  const [billableHours, setBillableHours] = useState(40);
  const [standingHours, setStandingHours] = useState(4);
  const standingRate = Number(agreement.standing_time_rate ?? hourlyRate * 0.5);
  const mobCharge = Number(agreement.mobilisation_charge ?? 0);
  const demobCharge = Number(agreement.demobilisation_charge ?? 0);
  const deposit = Number(agreement.deposit_required ?? 0);

  // Client calculations
  const clientGross = billableHours * hourlyRate + standingHours * standingRate + mobCharge + demobCharge;
  const clientNetPayable = Math.max(0, clientGross - deposit);

  // Supplier calculations for cross-hire
  const supplierStandingRate = Number(agreement.supplier_standing_rate ?? sourcingRate * 0.5);
  const supplierMob = Number(agreement.supplier_mobilisation_cost ?? 0);
  const supplierCostTotal = billableHours * sourcingRate + standingHours * supplierStandingRate + supplierMob;
  const companySpreadEarned = clientGross - supplierCostTotal;

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleGenerate = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await generateExternalPlantHireInvoice(agreement.id, {
        billable_hours: billableHours,
        standing_hours: standingHours,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to generate invoice instruction.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Generate Client Invoice & Settle Spread</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}

          <div className="border border-ink-mid bg-ink-light p-3 space-y-1">
            <p className="text-xs text-slate-light">Customer (B): <span className="text-paper font-semibold">{text(agreement, "customer_name")}</span></p>
            {isCrossHire && (
              <p className="text-xs text-slate-light">Sourced Owner (A): <span className="text-amber-300 font-semibold">{text(agreement, "supplier_name")}</span></p>
            )}
            <p className="text-xs text-slate-light">Agreement Ref: <span className="text-paper font-mono">{text(agreement, "hire_agreement_number")}</span></p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Billable Machine Hours</label>
              <input
                type="number"
                value={billableHours}
                onChange={(e) => setBillableHours(Number(e.target.value))}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Standing / Standby Hours</label>
              <input
                type="number"
                value={standingHours}
                onChange={(e) => setStandingHours(Number(e.target.value))}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
          </div>

          <div className="border-t border-ink-mid pt-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-light">
              <span>Client Operating Charge ({billableHours} hrs @ {fmtMoney(hourlyRate)})</span>
              <span>{fmtMoney(billableHours * hourlyRate)}</span>
            </div>
            <div className="flex justify-between text-slate-light">
              <span>Client Standing Charge ({standingHours} hrs @ {fmtMoney(standingRate)})</span>
              <span>{fmtMoney(standingHours * standingRate)}</span>
            </div>
            <div className="flex justify-between text-slate-light">
              <span>Client Mobilisation & Fees</span>
              <span>{fmtMoney(mobCharge + demobCharge)}</span>
            </div>
            <div className="flex justify-between font-semibold text-paper">
              <span>Gross Billable to Client (B)</span>
              <span>{fmtMoney(clientGross)}</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>Advance Security Deposit Deducted</span>
              <span>- {fmtMoney(deposit)}</span>
            </div>
            <div className="flex justify-between border-t border-ink-mid pt-1.5 font-bold text-sm text-signal">
              <span>Net Invoiced to Client (B)</span>
              <span>{fmtMoney(clientNetPayable)}</span>
            </div>

            {/* Cross-Hire Cost & Margin Reconciliation */}
            {isCrossHire && (
              <div className="mt-3 pt-3 border-t border-purple-500/30 bg-purple-500/10 p-2.5 rounded text-xs space-y-1">
                <div className="flex justify-between text-amber-200">
                  <span>Payable to Sourcing Owner A ({billableHours}h @ {fmtMoney(sourcingRate)})</span>
                  <span className="font-mono font-semibold">{fmtMoney(supplierCostTotal)}</span>
                </div>
                <div className="flex justify-between text-emerald-300 font-bold text-sm pt-1 border-t border-purple-500/20">
                  <span>Company Net Realized Margin (+${(hourlyRate - sourcingRate).toFixed(2)}/hr)</span>
                  <span className="font-mono">{fmtMoney(companySpreadEarned)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={submitting}
              className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
            >
              {submitting ? "Staging..." : "Commit Invoices & Margin"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupplierInvoiceModal({
  agreement,
  onClose,
  onSuccess,
}: {
  agreement: RecordItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    supplier_invoice_reference: text(agreement, "supplier_invoice_reference") || `INV-SUP-${Date.now().toString().slice(-6)}`,
    supplier_payable_amount: Number(agreement.supplier_payable_amount || 0),
    supplier_payment_status: (text(agreement, "supplier_payment_status") as any) || "invoice_received",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await recordExternalPlantHireSupplierInvoice(agreement.id, {
        supplier_invoice_reference: formData.supplier_invoice_reference,
        supplier_payable_amount: Number(formData.supplier_payable_amount),
        supplier_payment_status: formData.supplier_payment_status,
        notes: formData.notes || undefined,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to update supplier invoice.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Supplier A Cost Invoice & Reconciliation</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}

          <div className="border border-ink-mid bg-ink-light p-3">
            <p className="text-xs text-slate-light">Sourcing Owner (A): <span className="text-amber-300 font-semibold">{text(agreement, "supplier_name")}</span></p>
            <p className="text-xs text-slate-light">Client Contract: <span className="text-paper">{text(agreement, "customer_name")} ({text(agreement, "hire_agreement_number")})</span></p>
            <p className="text-xs text-slate-light">Sourcing Rate: <span className="font-mono text-paper font-semibold">{fmtMoney(Number(agreement.sourcing_rate ?? 0))}/hr</span></p>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Supplier Invoice Number</label>
            <input
              type="text"
              value={formData.supplier_invoice_reference}
              onChange={(e) => setFormData({ ...formData, supplier_invoice_reference: e.target.value })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="e.g. INV-9042"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Total Payable Amount ($)</label>
            <input
              type="number"
              step="0.01"
              value={formData.supplier_payable_amount}
              onChange={(e) => setFormData({ ...formData, supplier_payable_amount: Number(e.target.value) })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs font-mono font-bold text-amber-300"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Payment Status</label>
            <select
              value={formData.supplier_payment_status}
              onChange={(e) => setFormData({ ...formData, supplier_payment_status: e.target.value as any })}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
            >
              <option value="invoice_received">Invoice Received (Pending Approval)</option>
              <option value="approved">Approved for Payment</option>
              <option value="paid">Paid & Settled</option>
              <option value="disputed">Disputed / Meter Mismatch</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase text-slate mb-1">Reconciliation Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              placeholder="Verification against daily shift logs, meter variance, or payment terms..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ink-mid">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate hover:text-paper">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-signal px-4 py-2 text-xs font-semibold text-ink hover:bg-signal/90 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Update Supplier Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
