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
  updateExternalPlantHireAgreement,
} from "@/lib/api";
import { useApiQueries } from "@/hooks/useApiQueries";
import { useLiveTable } from "@/lib/live/LiveDataProvider";
import { OperationalTable, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/OperationalTable";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  DollarSign,
  FileCheck,
  FileSpreadsheet,
  HandCoins,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Truck,
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
  if (amount === null || amount === undefined) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
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
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "new" | "invoice" | "edit"; agreement?: RecordItem } | null>(null);

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
        text(a, "required_asset_type"),
        text(a, "invoice_instruction"),
      ]
        .join(" ")
        .toLowerCase();
      const matchStatus = statusFilter === "all" || text(a, "status") === statusFilter;
      return matchStatus && matchSearch.includes(query.toLowerCase());
    });
  }, [agreements, query, statusFilter]);

  const kpis = useMemo(() => {
    const activeAgreements = agreements.filter((a) => ["active", "dispatched"].includes(text(a, "status"))).length;
    const depositsHeld = agreements.reduce((sum, a) => sum + (Number(a.deposit_required) || 0), 0);
    const invoicePending = agreements.filter((a) => ["off_hire_requested", "returned", "invoice_instruction"].includes(text(a, "status"))).length;
    const debtorFollowUps = agreements.filter((a) => text(a, "status") === "debtor_follow_up").length;
    return { activeAgreements, depositsHeld, invoicePending, debtorFollowUps };
  }, [agreements]);

  return (
    <main className="min-h-screen bg-ink p-4 text-paper md:p-7">
      <div className="mx-auto max-w-[1600px]">
        <DashboardPageHeader
          eyebrow={{ label: "Assets / Plant & Equipment", icon: Truck }}
          title="Commercial Hire & Revenue"
          subtitle="External client contracts, rate cards, deposits, standing-time rules, billing batches, and debtor follow-ups."
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
                <Plus size={14} /> New Hire Agreement
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

        <section className="mb-6 grid gap-px overflow-hidden border border-ink-mid bg-ink-mid sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Active Commercial Hires</span>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{kpis.activeAgreements}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Security Deposits Held</span>
            <p className="mt-2 text-2xl font-bold text-blue-300">{fmtMoney(kpis.depositsHeld)}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Ready for Invoicing</span>
            <p className="mt-2 text-2xl font-bold text-amber-300">{kpis.invoicePending}</p>
          </div>
          <div className="bg-ink p-4">
            <span className="font-mono text-[10px] uppercase text-slate">Debtor Follow-Ups</span>
            <p className="mt-2 text-2xl font-bold text-purple-300">{kpis.debtorFollowUps}</p>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate" size={14} />
              <input
                type="text"
                placeholder="Search agreement ref, customer, asset..."
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
            description="Create client hire contracts with structured wet/dry rate cards, minimum hours, and mobilisation terms."
          />
        ) : (
          <div className="border border-ink-mid bg-ink overflow-x-auto">
            <OperationalTable className="min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Agreement Ref</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Mode / Rates</TableHead>
                  <TableHead>Deposit</TableHead>
                  <TableHead>Mobilisation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Debtor Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <tbody>
                {filtered.map((agr) => {
                  const rateCard = (agr.rate_card && typeof agr.rate_card === "object" ? agr.rate_card : {}) as Record<string, unknown>;
                  const hourlyRate = Number(rateCard.hourly_rate ?? rateCard.rate ?? 0);
                  const st = text(agr, "status");
                  return (
                    <TableRow key={agr.id}>
                      <TableCell>
                        <p className="font-semibold text-paper">{text(agr, "hire_agreement_number") || agr.id.slice(0, 8)}</p>
                        <p className="text-[11px] text-slate-light">Req: {text(agr, "request_number") || "Direct agreement"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-paper">{text(agr, "customer_name") || "Walk-in Client"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-paper capitalize">{text(agr, "hire_type").replace(/_/g, " ")}</p>
                        <p className="text-[11px] text-slate-light">
                          {fmtMoney(hourlyRate)}/hr | Standby: {fmtMoney(Number(agr.standing_time_rate ?? 0))}/hr
                        </p>
                      </TableCell>
                      <TableCell>{fmtMoney(Number(agr.deposit_required ?? 0))}</TableCell>
                      <TableCell>
                        <p className="text-xs text-paper">Mob: {fmtMoney(Number(agr.mobilisation_charge ?? 0))}</p>
                        <p className="text-[11px] text-slate-light">Demob: {fmtMoney(Number(agr.demobilisation_charge ?? 0))}</p>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex border border-slate/40 bg-ink-light px-2 py-0.5 font-mono text-[10px] uppercase text-paper">
                          {st.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-[11px] text-slate-light capitalize">
                          {text(agr, "debtor_follow_up_status").replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setModal({ type: "invoice", agreement: agr })}
                            className="border border-signal/60 bg-signal/10 px-2 py-1 text-[11px] text-signal hover:bg-signal/20"
                          >
                            Generate Invoice
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
              setNotice("Commercial hire agreement created.");
              void refetch();
            }}
          />
        )}

        {/* Modal: Generate Invoice */}
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
  const [formData, setFormData] = useState({
    plant_request_id: plantRequests[0]?.id || "",
    customer_name: "",
    hire_agreement_number: `HA-${Date.now().toString().slice(-6)}`,
    hire_type: "wet_hire",
    hourly_rate: 120,
    deposit_required: 1000,
    fuel_responsibility: "client",
    mobilisation_charge: 500,
    demobilisation_charge: 500,
    standing_time_rate: 60,
    overtime_rate: 150,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customer_name) {
      setErr("Customer name is required.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await createExternalPlantHireAgreement({
        plant_request_id: formData.plant_request_id || undefined,
        customer_name: formData.customer_name,
        hire_agreement_number: formData.hire_agreement_number,
        hire_type: formData.hire_type,
        rate_card: { hourly_rate: Number(formData.hourly_rate) },
        deposit_required: Number(formData.deposit_required),
        fuel_responsibility: formData.fuel_responsibility,
        mobilisation_charge: Number(formData.mobilisation_charge),
        demobilisation_charge: Number(formData.demobilisation_charge),
        standing_time_rate: Number(formData.standing_time_rate),
        overtime_rate: Number(formData.overtime_rate),
        status: "agreement_signed",
      });
      onSuccess();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Failed to create hire agreement.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Create Commercial Hire Agreement</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Customer / Client Name</label>
              <input
                type="text"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                placeholder="Client legal entity"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Agreement Number</label>
              <input
                type="text"
                value={formData.hire_agreement_number}
                onChange={(e) => setFormData({ ...formData, hire_agreement_number: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Hire Type</label>
              <select
                value={formData.hire_type}
                onChange={(e) => setFormData({ ...formData, hire_type: e.target.value })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              >
                <option value="wet_hire">Wet Hire (With Fuel/Operator)</option>
                <option value="dry_hire">Dry Hire (Machine Only)</option>
                <option value="hourly">Hourly Billing</option>
                <option value="daily">Daily Flat Rate</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Hourly Rate (USD)</label>
              <input
                type="number"
                value={formData.hourly_rate}
                onChange={(e) => setFormData({ ...formData, hourly_rate: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Deposit Required (USD)</label>
              <input
                type="number"
                value={formData.deposit_required}
                onChange={(e) => setFormData({ ...formData, deposit_required: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Mobilisation (USD)</label>
              <input
                type="number"
                value={formData.mobilisation_charge}
                onChange={(e) => setFormData({ ...formData, mobilisation_charge: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Demobilisation (USD)</label>
              <input
                type="number"
                value={formData.demobilisation_charge}
                onChange={(e) => setFormData({ ...formData, demobilisation_charge: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate mb-1">Standing Rate (USD/hr)</label>
              <input
                type="number"
                value={formData.standing_time_rate}
                onChange={(e) => setFormData({ ...formData, standing_time_rate: Number(e.target.value) })}
                className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-xs text-paper"
              />
            </div>
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
              {submitting ? "Creating..." : "Save Agreement"}
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
  const rateCard = (agreement.rate_card && typeof agreement.rate_card === "object" ? agreement.rate_card : {}) as Record<string, unknown>;
  const hourlyRate = Number(rateCard.hourly_rate ?? rateCard.rate ?? 0);
  const [billableHours, setBillableHours] = useState(40);
  const [standingHours, setStandingHours] = useState(4);
  const standingRate = Number(agreement.standing_time_rate ?? hourlyRate * 0.5);
  const mobCharge = Number(agreement.mobilisation_charge ?? 0);
  const demobCharge = Number(agreement.demobilisation_charge ?? 0);
  const deposit = Number(agreement.deposit_required ?? 0);

  const grossTotal = billableHours * hourlyRate + standingHours * standingRate + mobCharge + demobCharge;
  const netPayable = Math.max(0, grossTotal - deposit);

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
      <div className="relative w-full max-w-md border border-ink-mid bg-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-mid px-5 py-4">
          <h2 className="text-sm font-semibold text-paper">Generate Plant Commercial Invoice</h2>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">{err}</div>}
          <div className="border border-ink-mid bg-ink-light p-3">
            <p className="text-xs text-slate-light">Customer: <span className="text-paper font-semibold">{text(agreement, "customer_name")}</span></p>
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
              <span>Operating Charge ({billableHours} hrs @ {fmtMoney(hourlyRate)})</span>
              <span>{fmtMoney(billableHours * hourlyRate)}</span>
            </div>
            <div className="flex justify-between text-slate-light">
              <span>Standing Charge ({standingHours} hrs @ {fmtMoney(standingRate)})</span>
              <span>{fmtMoney(standingHours * standingRate)}</span>
            </div>
            <div className="flex justify-between text-slate-light">
              <span>Mobilisation + Demobilisation</span>
              <span>{fmtMoney(mobCharge + demobCharge)}</span>
            </div>
            <div className="flex justify-between text-slate-light">
              <span>Gross Billable Amount</span>
              <span className="font-semibold text-paper">{fmtMoney(grossTotal)}</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>Advance Security Deposit Deducted</span>
              <span>- {fmtMoney(deposit)}</span>
            </div>
            <div className="flex justify-between border-t border-ink-mid pt-2 font-bold text-sm text-signal">
              <span>Net Invoiced to Client</span>
              <span>{fmtMoney(netPayable)}</span>
            </div>
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
              {submitting ? "Staging..." : "Commit Draft Invoice"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
