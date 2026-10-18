"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Briefcase,
  Plus,
  Receipt,
  FileCheck2,
  AlertTriangle,
  Send,
  Loader2,
  DollarSign,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  Coins,
  FileSpreadsheet,
} from "lucide-react";
import {
  listSubcontractPackages,
  createSubcontractPackage,
  listSubcontractCertificates,
  createSubcontractCertificate,
  postCertificateToFinance,
  listSubcontractBackCharges,
  createSubcontractBackCharge,
  SubcontractPackageItem,
  SubcontractCertificateItem,
  SubcontractBackChargeItem,
} from "@/lib/api/projects";
import { getSubcontractors } from "@/lib/api/crm";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Props {
  projectId: string;
}

export function SubcontractCommercialsWorkspace({ projectId }: Props) {
  const [subTab, setSubTab] = useState<"packages" | "back_charges">("packages");
  const [packages, setPackages] = useState<SubcontractPackageItem[]>([]);
  const [backCharges, setBackCharges] = useState<SubcontractBackChargeItem[]>([]);
  const [subcontractors, setSubcontractors] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedPackage, setSelectedPackage] = useState<SubcontractPackageItem | null>(null);
  const [certificates, setCertificates] = useState<SubcontractCertificateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCerts, setLoadingCerts] = useState(false);

  // Package Modal State
  const [isPkgModalOpen, setIsPkgModalOpen] = useState(false);
  const [pkgNumber, setPkgNumber] = useState("");
  const [pkgTitle, setPkgTitle] = useState("");
  const [subcontractorId, setSubcontractorId] = useState("");
  const [trade, setTrade] = useState("Reinforced Concrete");
  const [awardValue, setAwardValue] = useState("50000");
  const [retentionPct, setRetentionPct] = useState("10");
  const [retentionCap, setRetentionCap] = useState("5000");
  const [scopeDesc, setScopeDesc] = useState("");
  const [savingPkg, setSavingPkg] = useState(false);

  // Certificate Modal State
  const [isCertModalOpen, setIsCertModalOpen] = useState(false);
  const [certNumber, setCertNumber] = useState("");
  const [valuationDate, setValuationDate] = useState(new Date().toISOString().split("T")[0]);
  const [claimedAmount, setClaimedAmount] = useState("");
  const [certifiedGross, setCertifiedGross] = useState("");
  const [certNotes, setCertNotes] = useState("");
  const [savingCert, setSavingCert] = useState(false);
  const [postingCertId, setPostingCertId] = useState<string | null>(null);

  // Back-Charge Modal State
  const [isBcModalOpen, setIsBcModalOpen] = useState(false);
  const [bcPkgId, setBcPkgId] = useState("");
  const [bcNumber, setBcNumber] = useState("");
  const [bcTitle, setBcTitle] = useState("");
  const [bcCategory, setBcCategory] = useState<
    "defective_work_rectification" | "plant_hire_recovery" | "material_usage_recovery" | "site_cleaning_penalty" | "safety_non_compliance"
  >("defective_work_rectification");
  const [bcAmount, setBcAmount] = useState("");
  const [bcEvidence, setBcEvidence] = useState("");
  const [savingBc, setSavingBc] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [pkgRes, bcRes, subRes] = await Promise.all([
        listSubcontractPackages(projectId),
        listSubcontractBackCharges(projectId),
        getSubcontractors(),
      ]);
      if (pkgRes?.data) setPackages(pkgRes.data);
      if (bcRes?.data) setBackCharges(bcRes.data);
      if (subRes?.data) setSubcontractors(subRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadCertificates = useCallback(async (pkgId: string) => {
    setLoadingCerts(true);
    try {
      const res = await listSubcontractCertificates(projectId, pkgId);
      if (res?.data) setCertificates(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingCerts(false);
    }
  }, [projectId]);

  const handleSelectPackage = (pkg: SubcontractPackageItem) => {
    setSelectedPackage(pkg);
    void loadCertificates(pkg.id);
  };

  // KPI Calculations
  const stats = useMemo(() => {
    const totalAward = packages.reduce((acc, p) => acc + (Number(p.award_value) || 0), 0);
    const totalGross = packages.reduce((acc, p) => acc + (Number(p.total_certified_gross) || 0), 0);
    const totalRetention = packages.reduce((acc, p) => acc + (Number(p.total_retention_held) || 0), 0);
    const totalContra = packages.reduce((acc, p) => acc + (Number(p.total_contra_deducted) || 0), 0);
    const totalNet = packages.reduce((acc, p) => acc + (Number(p.total_net_payable) || 0), 0);
    return { totalAward, totalGross, totalRetention, totalContra, totalNet, count: packages.length };
  }, [packages]);

  // Handle Create Subcontract Package
  const handleOpenAddPkg = () => {
    const count = packages.length + 1;
    setPkgNumber(`SC-PKG-${String(count).padStart(3, "0")}`);
    setPkgTitle("");
    setTrade("Reinforced Concrete");
    setAwardValue("50000");
    setRetentionPct("10");
    setRetentionCap("5000");
    setScopeDesc("");
    if (subcontractors.length > 0) setSubcontractorId(subcontractors[0].id);
    setIsPkgModalOpen(true);
  };

  const handleCreatePackage = async () => {
    if (!pkgNumber.trim() || !pkgTitle.trim() || !subcontractorId) return;
    setSavingPkg(true);
    try {
      await createSubcontractPackage(projectId, {
        package_number: pkgNumber.trim(),
        title: pkgTitle.trim(),
        subcontractor_id: subcontractorId,
        trade,
        award_value: parseFloat(awardValue) || 0,
        retention_percentage: parseFloat(retentionPct) || 10,
        retention_cap: parseFloat(retentionCap) || 0,
        scope_description: scopeDesc.trim() || undefined,
      });
      setIsPkgModalOpen(false);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPkg(false);
    }
  };

  // Handle Create Certificate
  const handleOpenAddCert = () => {
    if (!selectedPackage) return;
    const nextNum = `IPC-${String(certificates.length + 1).padStart(2, "0")}`;
    setCertNumber(nextNum);
    setValuationDate(new Date().toISOString().split("T")[0]);
    setClaimedAmount("");
    setCertifiedGross("");
    setCertNotes("");
    setIsCertModalOpen(true);
  };

  const handleCreateCertificate = async () => {
    if (!selectedPackage || !certNumber.trim() || !certifiedGross) return;
    setSavingCert(true);
    try {
      await createSubcontractCertificate(projectId, selectedPackage.id, {
        certificate_number: certNumber.trim(),
        valuation_date: valuationDate,
        claimed_amount: parseFloat(claimedAmount) || 0,
        certified_gross_amount: parseFloat(certifiedGross) || 0,
        notes: certNotes.trim() || undefined,
      });
      setIsCertModalOpen(false);
      await loadCertificates(selectedPackage.id);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingCert(false);
    }
  };

  // Handle Post to General Finance
  const handlePostToFinance = async (cert: SubcontractCertificateItem) => {
    if (!selectedPackage) return;
    setPostingCertId(cert.id);
    try {
      await postCertificateToFinance(projectId, selectedPackage.id, cert.id);
      await loadCertificates(selectedPackage.id);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setPostingCertId(null);
    }
  };

  // Handle Create Back-Charge
  const handleOpenAddBc = () => {
    const count = backCharges.length + 1;
    setBcNumber(`BC-${String(count).padStart(3, "0")}`);
    setBcTitle("");
    setBcCategory("defective_work_rectification");
    setBcAmount("");
    setBcEvidence("");
    if (packages.length > 0) setBcPkgId(packages[0].id);
    setIsBcModalOpen(true);
  };

  const handleCreateBackCharge = async () => {
    if (!bcNumber.trim() || !bcTitle.trim() || !bcAmount || !bcPkgId) return;
    const pkg = packages.find((p) => p.id === bcPkgId);
    if (!pkg) return;

    setSavingBc(true);
    try {
      await createSubcontractBackCharge(projectId, {
        package_id: bcPkgId,
        subcontractor_id: pkg.subcontractor_id,
        charge_number: bcNumber.trim(),
        title: bcTitle.trim(),
        reason_category: bcCategory,
        amount: parseFloat(bcAmount) || 0,
        evidence_reference: bcEvidence.trim() || undefined,
      });
      setIsBcModalOpen(false);
      await loadData();
      if (selectedPackage && selectedPackage.id === bcPkgId) {
        await loadCertificates(selectedPackage.id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingBc(false);
    }
  };

  const statusPills: Record<string, string> = {
    awarded: "text-amber-400 border-amber-500/40 bg-amber-950/20",
    active: "text-sky-400 border-sky-500/40 bg-sky-950/20",
    certified: "text-purple-400 border-purple-500/40 bg-purple-950/20",
    approved: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    posted_to_finance: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    paid: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    rejected: "text-red-400 border-red-500/40 bg-red-950/20",
  };

  return (
    <div className="space-y-6">
      {/* KPI Overview Banner */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Subcontract Commitments</span>
          <p className="mt-1 font-mono text-xl font-bold text-paper">
            {formatCurrency(stats.totalAward)}
          </p>
          <span className="font-mono text-[11px] text-slate-light">{stats.count} Active Packages</span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Certified Gross Value</span>
          <p className="mt-1 font-mono text-xl font-bold text-sky-400">
            {formatCurrency(stats.totalGross)}
          </p>
          <span className="font-mono text-[11px] text-slate-light">
            {stats.totalAward > 0 ? Math.round((stats.totalGross / stats.totalAward) * 100) : 0}% of Commitment
          </span>
        </div>

        <div className="border border-amber-500/30 bg-amber-950/15 p-4">
          <span className="font-mono text-[10px] uppercase text-amber-400">Retention Held</span>
          <p className="mt-1 font-mono text-xl font-bold text-amber-300">
            {formatCurrency(stats.totalRetention)}
          </p>
          <span className="font-mono text-[11px] text-slate-light">Protected Commercial Reserve</span>
        </div>

        <div className="border border-red-500/30 bg-red-950/15 p-4">
          <span className="font-mono text-[10px] uppercase text-red-400">Back-Charges Applied</span>
          <p className="mt-1 font-mono text-xl font-bold text-red-300">
            -{formatCurrency(stats.totalContra)}
          </p>
          <span className="font-mono text-[11px] text-slate-light">Contra Recoveries</span>
        </div>

        <div className="border border-emerald-500/30 bg-emerald-950/15 p-4">
          <span className="font-mono text-[10px] uppercase text-emerald-400">Net Certified Payable</span>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-300">
            {formatCurrency(stats.totalNet)}
          </p>
          <span className="font-mono text-[11px] text-slate-light">Actual Subcontract Liability</span>
        </div>
      </section>

      {/* Workspace Sub-Navigation Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-ink-mid bg-ink p-3">
        <div className="flex border border-ink-mid bg-ink-light">
          <button
            type="button"
            onClick={() => setSubTab("packages")}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors flex items-center gap-2 ${
              subTab === "packages" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            <span>Subcontract Work Packages ({packages.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab("back_charges")}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors flex items-center gap-2 ${
              subTab === "back_charges" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Contra / Back-Charges ({backCharges.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {subTab === "packages" ? (
            <button
              type="button"
              onClick={handleOpenAddPkg}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 border border-signal bg-signal px-3.5 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 transition-all min-h-[38px]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Award Subcontract</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenAddBc}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 border border-red-500/60 bg-red-950/40 px-3.5 py-2 font-mono text-xs font-bold uppercase text-red-300 hover:bg-red-500 hover:text-ink transition-all min-h-[38px]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Issue Back-Charge</span>
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: Subcontract Packages & Valuations */}
      {subTab === "packages" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Packages List */}
          <div className="lg:col-span-1 space-y-3">
            <span className="font-mono text-xs uppercase font-bold text-slate-light block">
              Work Packages Register
            </span>

            {packages.length === 0 ? (
              <div className="border border-ink-mid bg-ink p-8 text-center text-xs font-mono text-slate-light">
                No subcontract packages awarded yet. Click &quot;Award Subcontract&quot; to initialize commercial package.
              </div>
            ) : (
              <div className="space-y-2">
                {packages.map((pkg) => {
                  const isSelected = selectedPackage?.id === pkg.id;
                  return (
                    <div
                      key={pkg.id}
                      onClick={() => handleSelectPackage(pkg)}
                      className={`p-3.5 border cursor-pointer transition-all space-y-2 ${
                        isSelected
                          ? "border-signal bg-signal/10"
                          : "border-ink-mid bg-ink hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-signal">{pkg.package_number}</span>
                        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.2 border ${statusPills[pkg.status] || statusPills.awarded}`}>
                          {pkg.status}
                        </span>
                      </div>

                      <div>
                        <h4 className="font-display text-sm font-bold text-paper">{pkg.title}</h4>
                        <span className="text-xs font-mono text-slate-light">{pkg.subcontractor_name}</span>
                      </div>

                      <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-ink-mid/40">
                        <span className="text-slate-light">Award: {formatCurrency(pkg.award_value)}</span>
                        <span className="text-emerald-400 font-bold">{formatCurrency(pkg.total_certified_gross)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Package Details & Certificates Ledger */}
          <div className="lg:col-span-2 space-y-4">
            {selectedPackage ? (
              <div className="border border-ink-mid bg-ink p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid/60 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-signal">{selectedPackage.package_number}</span>
                      <span className="font-mono text-xs text-slate-light">Trade: {selectedPackage.trade}</span>
                      <span className="font-mono text-xs text-amber-400">Retention: {selectedPackage.retention_percentage}% (Cap: {formatCurrency(selectedPackage.retention_cap || 0)})</span>
                    </div>
                    <h3 className="font-display text-lg font-bold text-paper mt-1">{selectedPackage.title}</h3>
                    <p className="font-mono text-xs text-slate-light">Contractor: {selectedPackage.subcontractor_name}</p>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenAddCert}
                    className="inline-flex items-center gap-1.5 border border-signal bg-signal px-3.5 py-1.5 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 transition-all"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Issue Certificate</span>
                  </button>
                </div>

                {/* Certificates Table */}
                <div className="space-y-2">
                  <span className="font-mono text-xs uppercase font-bold text-paper block">
                    Interim Payment Certificates (IPC Ledger)
                  </span>

                  {loadingCerts ? (
                    <div className="py-8 text-center text-xs font-mono text-slate-light">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2 text-signal" />
                      Loading certificates...
                    </div>
                  ) : certificates.length === 0 ? (
                    <div className="border border-ink-mid/60 bg-ink-light/20 p-6 text-center text-xs font-mono text-slate-light">
                      No payment certificates issued yet for this package. Click &quot;Issue Certificate&quot; to record valuation.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-ink-mid">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="border-b border-ink-mid bg-ink-light/40 text-slate-light uppercase text-[10px]">
                          <tr>
                            <th className="p-2.5">IPC #</th>
                            <th className="p-2.5">Valuation Date</th>
                            <th className="p-2.5 text-right">Certified Gross</th>
                            <th className="p-2.5 text-right">Retention Held</th>
                            <th className="p-2.5 text-right">Contra Deducted</th>
                            <th className="p-2.5 text-right">Net Payable</th>
                            <th className="p-2.5">Status</th>
                            <th className="p-2.5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-mid/40">
                          {certificates.map((c) => {
                            const isPosted = c.status === "posted_to_finance";
                            return (
                              <tr key={c.id} className="hover:bg-ink-light/20 transition-colors">
                                <td className="p-2.5 font-bold text-paper">{c.certificate_number}</td>
                                <td className="p-2.5 text-slate-light">{formatDate(c.valuation_date)}</td>
                                <td className="p-2.5 text-right font-bold text-paper">{formatCurrency(c.certified_gross_amount)}</td>
                                <td className="p-2.5 text-right text-amber-400">-{formatCurrency(c.retention_deducted)}</td>
                                <td className="p-2.5 text-right text-red-400">-{formatCurrency(c.contra_charges_deducted)}</td>
                                <td className="p-2.5 text-right font-bold text-emerald-400">{formatCurrency(c.net_payable_amount)}</td>
                                <td className="p-2.5">
                                  <span className={`text-[10px] uppercase px-1.5 py-0.2 border ${statusPills[c.status] || statusPills.certified}`}>
                                    {c.status.replace(/_/g, " ")}
                                  </span>
                                </td>
                                <td className="p-2.5 text-right">
                                  {!isPosted ? (
                                    <button
                                      type="button"
                                      onClick={() => handlePostToFinance(c)}
                                      disabled={postingCertId === c.id}
                                      className="border border-emerald-500/50 bg-emerald-950/30 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500 hover:text-ink transition-colors disabled:opacity-50"
                                      title="Post liability to General Ledger and Retention to Ledger"
                                    >
                                      {postingCertId === c.id ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Post to Finance"}
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-slate-light flex items-center justify-end gap-1">
                                      <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Posted
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="border border-ink-mid bg-ink p-12 text-center text-xs font-mono text-slate-light">
                Select a subcontract package from the left to view interim payment certificates, retention accruals, and contra-charges.
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: Contra / Back-Charges Register */}
      {subTab === "back_charges" && (
        <section className="border border-ink-mid bg-ink overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="border-b border-ink-mid bg-ink-light/40 text-slate-light uppercase text-[10px]">
              <tr>
                <th className="p-3">Charge #</th>
                <th className="p-3">Title & Reason</th>
                <th className="p-3">Package / Subcontractor</th>
                <th className="p-3 text-right">Contra Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-mid/40">
              {backCharges.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-light">
                    No back-charges or contra-charges recorded for this project.
                  </td>
                </tr>
              ) : (
                backCharges.map((bc) => (
                  <tr key={bc.id} className="hover:bg-ink-light/20 transition-colors">
                    <td className="p-3 font-bold text-red-400">{bc.charge_number}</td>
                    <td className="p-3">
                      <div className="font-semibold text-paper">{bc.title}</div>
                      <div className="text-[10px] text-slate-light capitalize">{bc.reason_category.replace(/_/g, " ")}</div>
                    </td>
                    <td className="p-3">
                      <div className="text-paper">{bc.package_title || bc.package_number}</div>
                      <div className="text-[10px] text-slate-light">{bc.subcontractor_name}</div>
                    </td>
                    <td className="p-3 text-right font-bold text-red-400">
                      -{formatCurrency(bc.amount)}
                    </td>
                    <td className="p-3">
                      <span className={`text-[10px] uppercase px-2 py-0.5 border ${
                        bc.status === "applied_to_certificate"
                          ? "border-emerald-500/40 text-emerald-400 bg-emerald-950/20"
                          : "border-amber-500/40 text-amber-400 bg-amber-950/20"
                      }`}>
                        {bc.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3 text-slate-light">{formatDate(bc.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Modal: Award Subcontract Package */}
      {isPkgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <h3 className="font-display text-lg font-bold text-paper">Award Subcontract Package</h3>
              <button type="button" onClick={() => setIsPkgModalOpen(false)} className="text-slate-light hover:text-paper font-mono text-base">
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Package Number *</label>
                <input
                  value={pkgNumber}
                  onChange={(e) => setPkgNumber(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Trade *</label>
                <select
                  value={trade}
                  onChange={(e) => setTrade(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  <option value="Reinforced Concrete">Reinforced Concrete</option>
                  <option value="Formwork & Shuttering">Formwork & Shuttering</option>
                  <option value="Structural Steel">Structural Steel</option>
                  <option value="Brickwork & Masonry">Brickwork & Masonry</option>
                  <option value="Electrical Services">Electrical Services</option>
                  <option value="Plumbing & Drainage">Plumbing & Drainage</option>
                  <option value="HVAC / Mechanical">HVAC / Mechanical</option>
                  <option value="Roofing & Waterproofing">Roofing & Waterproofing</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Package Title *</label>
              <input
                value={pkgTitle}
                onChange={(e) => setPkgTitle(e.target.value)}
                placeholder="e.g. Substructure Reinforced Concrete Works"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Subcontractor *</label>
              <select
                value={subcontractorId}
                onChange={(e) => setSubcontractorId(e.target.value)}
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              >
                {subcontractors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Award Value ($) *</label>
                <input
                  type="number"
                  value={awardValue}
                  onChange={(e) => setAwardValue(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Retention (%)</label>
                <input
                  type="number"
                  value={retentionPct}
                  onChange={(e) => setRetentionPct(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Retention Cap ($)</label>
                <input
                  type="number"
                  value={retentionCap}
                  onChange={(e) => setRetentionCap(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Scope Description</label>
              <textarea
                rows={2}
                value={scopeDesc}
                onChange={(e) => setScopeDesc(e.target.value)}
                placeholder="Bill of quantities reference, deliverables, milestones..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-mid">
              <button
                type="button"
                onClick={() => setIsPkgModalOpen(false)}
                className="border border-ink-mid px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePackage}
                disabled={savingPkg || !pkgTitle.trim()}
                className="border border-signal bg-signal px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {savingPkg ? "Awarding..." : "Award Package"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Issue Interim Certificate */}
      {isCertModalOpen && selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <h3 className="font-display text-lg font-bold text-paper">
                Issue Payment Certificate ({selectedPackage.package_number})
              </h3>
              <button type="button" onClick={() => setIsCertModalOpen(false)} className="text-slate-light hover:text-paper font-mono text-base">
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Certificate # *</label>
                <input
                  value={certNumber}
                  onChange={(e) => setCertNumber(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Valuation Date *</label>
                <input
                  type="date"
                  value={valuationDate}
                  onChange={(e) => setValuationDate(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Subcontractor Claimed ($)</label>
                <input
                  type="number"
                  value={claimedAmount}
                  onChange={(e) => setClaimedAmount(e.target.value)}
                  placeholder="e.g. 20000"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">QS Certified Gross ($) *</label>
                <input
                  type="number"
                  value={certifiedGross}
                  onChange={(e) => setCertifiedGross(e.target.value)}
                  placeholder="e.g. 18500"
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            <div className="p-3 border border-ink-mid/60 bg-ink-light/20 text-xs font-mono space-y-1">
              <span className="font-bold text-signal block">Commercial Rule Verification:</span>
              <div>Retention deduction: {selectedPackage.retention_percentage}% automatically applied to incremental gross.</div>
              <div>Approved contra-charges will automatically offset against net payable.</div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Valuation Notes / Assessment</label>
              <textarea
                rows={2}
                value={certNotes}
                onChange={(e) => setCertNotes(e.target.value)}
                placeholder="Inspected levels, completed reinforcement, deductions..."
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-mid">
              <button
                type="button"
                onClick={() => setIsCertModalOpen(false)}
                className="border border-ink-mid px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCertificate}
                disabled={savingCert || !certifiedGross}
                className="border border-signal bg-signal px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                {savingCert ? "Certifying..." : "Certify Valuation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Issue Back-Charge */}
      {isBcModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 rounded-t-xl sm:rounded-none">
            <div className="flex items-center justify-between border-b border-ink-mid pb-3">
              <h3 className="font-display text-lg font-bold text-paper">Issue Contra / Back-Charge Notice</h3>
              <button type="button" onClick={() => setIsBcModalOpen(false)} className="text-slate-light hover:text-paper font-mono text-base">
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono uppercase text-slate">Charge # *</label>
                <input
                  value={bcNumber}
                  onChange={(e) => setBcNumber(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-slate">Target Package *</label>
                <select
                  value={bcPkgId}
                  onChange={(e) => setBcPkgId(e.target.value)}
                  className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
                >
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.package_number} - {p.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Contra Reason Category *</label>
              <select
                value={bcCategory}
                onChange={(e) => setBcCategory(e.target.value as any)}
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              >
                <option value="defective_work_rectification">Defective Work Rectification by Main Contractor</option>
                <option value="plant_hire_recovery">Plant / Crane / Equipment Hire Usage Recovery</option>
                <option value="material_usage_recovery">Materials Supplied from Main Store</option>
                <option value="site_cleaning_penalty">Site Cleaning & Rubbish Removal Penalty</option>
                <option value="safety_non_compliance">HSE Non-Compliance Penalty</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Notice Title *</label>
              <input
                value={bcTitle}
                onChange={(e) => setBcTitle(e.target.value)}
                placeholder="e.g. Concrete Grinding Remediation on Grid 4 Slab"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Deduction Amount ($) *</label>
              <input
                type="number"
                value={bcAmount}
                onChange={(e) => setBcAmount(e.target.value)}
                placeholder="e.g. 1200"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal font-mono min-h-[44px] sm:min-h-0"
              />
            </div>

            <div>
              <label className="block text-xs font-mono uppercase text-slate">Evidence Reference / Diary Entry</label>
              <input
                value={bcEvidence}
                onChange={(e) => setBcEvidence(e.target.value)}
                placeholder="e.g. Site Instruction #14, Daily Report 2026-10-14"
                className="mt-1 w-full border border-ink-mid bg-ink-light p-2.5 text-base sm:text-xs text-paper outline-none focus:border-signal min-h-[44px] sm:min-h-0"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-mid">
              <button
                type="button"
                onClick={() => setIsBcModalOpen(false)}
                className="border border-ink-mid px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateBackCharge}
                disabled={savingBc || !bcTitle.trim() || !bcAmount}
                className="border border-red-500 bg-red-600 px-4 py-2.5 min-h-[44px] sm:min-h-[36px] font-mono text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-50"
              >
                {savingBc ? "Issuing..." : "Issue Back-Charge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
