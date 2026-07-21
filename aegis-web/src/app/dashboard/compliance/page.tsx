"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, BadgeCheck, Loader2, Plus, RefreshCw, Search,
  ShieldCheck, X, FileText, ClipboardList, ShieldAlert, CheckCircle2,
  CalendarDays, Flame, Building, Users, Truck
} from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import {
  getComplianceObligations,
  createComplianceObligation,
  getComplianceEmployeeCredentials,
  getComplianceEquipmentCredentials,
  getComplianceCorrectiveActions,
  createComplianceCorrectiveAction,
  getComplianceScore,
  getComplianceDeploymentRequirements,
  createComplianceDeploymentRequirement,
  archiveComplianceDeploymentRequirement,
  getComplianceDeploymentGateChecks,
  overrideComplianceDeploymentGateCheck,
  getHseIncidents,
  getInternalProjects
} from "@/lib/api";

type RecordData = Record<string, any>;
type ComplianceTab = "obligations" | "employees" | "equipment" | "deployment-gates" | "corrective-actions" | "incidents";

const TAB_ROUTES: Record<ComplianceTab, string> = {
  obligations: "/dashboard/compliance/obligations",
  employees: "/dashboard/compliance/employees",
  equipment: "/dashboard/compliance/equipment",
  "deployment-gates": "/dashboard/compliance/deployment-gates",
  "corrective-actions": "/dashboard/compliance/corrective-actions",
  incidents: "/dashboard/compliance/incidents",
};

function normalizeTab(value: string | null | undefined): ComplianceTab {
  return value && value in TAB_ROUTES ? (value as ComplianceTab) : "obligations";
}

function textValue(value: unknown, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dateValue(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-ZW", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function statusClass(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["compliant", "active", "pass", "completed", "resolved"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  }
  if (["pending", "in_progress", "conditional"].includes(normalized)) {
    return "border-blue-500/30 bg-blue-950/20 text-blue-300";
  }
  if (["non_compliant", "fail", "expired", "open", "overdue", "critical", "major", "serious", "fatal"].includes(normalized)) {
    return "border-red-500/30 bg-red-950/20 text-red-300";
  }
  return "border-slate-500/30 bg-slate-950/20 text-slate-300";
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
    return "The compliance feed is still synchronizing. Please retry once the connection is ready.";
  }
  return "Failed to load compliance workspace data.";
}

function normalizeActionError(reason: unknown, fallback: string) {
  const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/aborted|cancelled|timed out|network error|fetch failed|not found/i.test(rawMessage)) {
    return fallback;
  }
  return fallback;
}

export default function ComplianceDashboard() {
  return (
    <RBACGuard allowedRoles={["Executive (Admin)", "Compliance Officer", "Internal Auditor", "Project Manager"]}>
      <ComplianceWorkspace />
    </RBACGuard>
  );
}

function ComplianceWorkspace() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ComplianceTab>(() => normalizeTab(searchParams?.get("tab")));
  const [obligations, setObligations] = useState<RecordData[]>([]);
  const [empCredentials, setEmpCredentials] = useState<RecordData[]>([]);
  const [eqCredentials, setEqCredentials] = useState<RecordData[]>([]);
  const [deploymentRequirements, setDeploymentRequirements] = useState<RecordData[]>([]);
  const [deploymentGateChecks, setDeploymentGateChecks] = useState<RecordData[]>([]);
  const [correctiveActions, setCorrectiveActions] = useState<RecordData[]>([]);
  const [incidents, setIncidents] = useState<RecordData[]>([]);
  const [projects, setProjects] = useState<RecordData[]>([]);
  const [score, setScore] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  // Modals
  const [showObligationModal, setShowObligationModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showRequirementModal, setShowRequirementModal] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<RecordData | null>(null);

  // Form Fields
  const [obligationForm, setObligationForm] = useState({ title: "", authority: "ZIMRA", category: "tax", due_date: "", responsible_person: "", notes: "" });
  const [actionForm, setActionForm] = useState({ finding_trigger: "", responsible_person: "", due_date: "", priority: "high", status: "open", notes: "" });
  const [requirementForm, setRequirementForm] = useState({
    requirement_scope: "equipment_assignment",
    certification_name: "",
    required_verification_status: "verified",
    warning_days: "30",
    project_id: "",
    target_role: "",
    equipment_type: ""
  });
  const [overrideForm, setOverrideForm] = useState({ reason: "", override_reference: "" });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [obRes, empCredRes, eqCredRes, reqRes, gateRes, actionsRes, incRes, scoreRes, projRes] = await Promise.allSettled([
        getComplianceObligations(),
        getComplianceEmployeeCredentials(),
        getComplianceEquipmentCredentials(),
        getComplianceDeploymentRequirements(),
        getComplianceDeploymentGateChecks({ limit: 100 }),
        getComplianceCorrectiveActions(),
        getHseIncidents(),
        getComplianceScore(),
        getInternalProjects()
      ]);
      const warnings: string[] = [];
      if (obRes.status === "fulfilled") setObligations(obRes.value.data || []);
      else warnings.push("Obligations register could not be loaded.");
      if (empCredRes.status === "fulfilled") setEmpCredentials(empCredRes.value.data || []);
      else warnings.push("Employee credentials could not be loaded.");
      if (eqCredRes.status === "fulfilled") setEqCredentials(eqCredRes.value.data || []);
      else warnings.push("Equipment credentials could not be loaded.");
      if (reqRes.status === "fulfilled") setDeploymentRequirements(reqRes.value.data || []);
      else warnings.push("Deployment requirements could not be loaded.");
      if (gateRes.status === "fulfilled") setDeploymentGateChecks(gateRes.value.data || []);
      else warnings.push("Deployment gate checks could not be loaded.");
      if (actionsRes.status === "fulfilled") setCorrectiveActions(actionsRes.value.data || []);
      else warnings.push("Corrective actions could not be loaded.");
      if (incRes.status === "fulfilled") setIncidents(incRes.value.data || []);
      else warnings.push("HSE incidents could not be loaded.");
      if (scoreRes.status === "fulfilled") setScore(typeof scoreRes.value.data?.score === "number" ? scoreRes.value.data.score : null);
      else warnings.push("Compliance score could not be loaded.");
      if (projRes.status === "fulfilled") setProjects(projRes.value.data || []);
      else warnings.push("Project register could not be loaded.");
      setSourceWarnings(warnings);
      if (obRes.status === "rejected") {
        throw new Error(loadFailureMessage(obRes.reason));
      }
    } catch (err) {
      setError(loadFailureMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setActiveTab(normalizeTab(searchParams?.get("tab")));
  }, [searchParams]);

  const handleCreateObligation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!obligationForm.title || !obligationForm.due_date) return;
    try {
      await createComplianceObligation(obligationForm);
      setNotice("Obligation added to register.");
      setShowObligationModal(false);
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to add compliance obligation."));
    }
  };

  const handleCreateCorrectiveAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionForm.finding_trigger || !actionForm.due_date) return;
    try {
      await createComplianceCorrectiveAction(actionForm);
      setNotice("Corrective action generated.");
      setShowActionModal(false);
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to record corrective action."));
    }
  };

  const handleCreateRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requirementForm.certification_name) return;
    try {
      await createComplianceDeploymentRequirement({
        requirement_scope: requirementForm.requirement_scope,
        certification_name: requirementForm.certification_name,
        required_verification_status: requirementForm.required_verification_status,
        warning_days: Number(requirementForm.warning_days || 30),
        project_id: requirementForm.project_id || null,
        target_role: requirementForm.target_role || null,
        equipment_type: requirementForm.equipment_type || null,
        is_active: true
      });
      setNotice("Deployment compliance requirement created.");
      setShowRequirementModal(false);
      setRequirementForm({ requirement_scope: "equipment_assignment", certification_name: "", required_verification_status: "verified", warning_days: "30", project_id: "", target_role: "", equipment_type: "" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to create deployment requirement."));
    }
  };

  const handleArchiveRequirement = async (id: string) => {
    try {
      await archiveComplianceDeploymentRequirement(id);
      setNotice("Deployment compliance requirement archived.");
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to archive deployment requirement."));
    }
  };

  const handleOverrideGate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideTarget || overrideForm.reason.trim().length < 12) return;
    try {
      await overrideComplianceDeploymentGateCheck(String(overrideTarget.id), {
        reason: overrideForm.reason.trim(),
        override_reference: overrideForm.override_reference.trim() || undefined
      });
      setNotice("Controlled deployment gate override recorded.");
      setOverrideTarget(null);
      setOverrideForm({ reason: "", override_reference: "" });
      await loadData();
    } catch (err) {
      setNotice(normalizeActionError(err, "Failed to record deployment gate override."));
    }
  };

  const complianceKPIS = useMemo(() => {
    const expiredCount = empCredentials.filter(c => c.status === "expired").length + eqCredentials.filter(c => c.status === "expired").length;
    const expiringSoon = empCredentials.filter(c => c.status === "expiring_soon").length + eqCredentials.filter(c => c.status === "expiring_soon").length;
    const openActions = correctiveActions.filter(a => a.status === "open" || a.status === "overdue").length;
    const blockedDeployments = deploymentGateChecks.filter(g => g.status === "blocked").length;
    return {
      expiredCount,
      expiringSoon,
      openActions,
      blockedDeployments
    };
  }, [empCredentials, eqCredentials, correctiveActions, deploymentGateChecks]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center bg-ink">
        <Loader2 className="h-8 w-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Notice Banner */}
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
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="font-semibold">Compliance data could not be loaded.</p>
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

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-paper tracking-tight font-display">Compliance, Legal & Assurance</h1>
          <p className="text-sm text-slate-light font-sans mt-0.5">SNC compliance gates, regulatory filings, corrective action plans and incident logs.</p>
        </div>
        <div className="flex space-x-2">
          {activeTab === "obligations" && (
            <button
              onClick={() => setShowObligationModal(true)}
              className="flex items-center space-x-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Record Obligation</span>
            </button>
          )}
          {activeTab === "corrective-actions" && (
            <button
              onClick={() => setShowActionModal(true)}
              className="flex items-center space-x-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Issue CAPA Action</span>
            </button>
          )}
          {activeTab === "deployment-gates" && (
            <button
              onClick={() => setShowRequirementModal(true)}
              className="flex items-center space-x-2 bg-signal text-ink font-semibold px-4 py-2 rounded-sm text-sm hover:bg-signal/95 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Add Gate Requirement</span>
            </button>
          )}
        </div>
      </div>

      {/* Compliance Stats strip */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm flex justify-between items-center">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Compliance Score</p>
            <p className={`text-xl font-bold tracking-tight mt-1 ${score === null ? 'text-slate-light' : score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
              {score === null ? "No score" : `${score}%`}
            </p>
            {score === null && <p className="mt-1 text-[11px] text-slate">Score appears after obligations, credentials, gates, or corrective actions are recorded.</p>}
          </div>
          <ShieldCheck className={`h-8 w-8 ${score === null ? 'text-slate' : score >= 80 ? 'text-emerald-400' : 'text-amber-500'}`} />
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Total Obligations</p>
          <p className="text-xl font-semibold text-paper tracking-tight mt-1">{obligations.length}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Expiring Soon (30d)</p>
          <p className="text-xl font-semibold text-amber-500 tracking-tight mt-1">{complianceKPIS.expiringSoon}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Expired Credentials</p>
          <p className="text-xl font-semibold text-red-500 tracking-tight mt-1">{complianceKPIS.expiredCount}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-4 rounded-sm">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate">Blocked Deployments</p>
          <p className="text-xl font-semibold text-red-400 tracking-tight mt-1">{complianceKPIS.blockedDeployments}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-ink-mid">
        <Link
          href={TAB_ROUTES.obligations}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "obligations" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Obligation Register
        </Link>
        <Link
          href={TAB_ROUTES.employees}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "employees" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Employee Credentials
        </Link>
        <Link
          href={TAB_ROUTES.equipment}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "equipment" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Equipment Licenses
        </Link>
        <Link
          href={TAB_ROUTES["deployment-gates"]}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "deployment-gates" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Deployment Gates
        </Link>
        <Link
          href={TAB_ROUTES["corrective-actions"]}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "corrective-actions" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          Corrective Actions (CAPA)
        </Link>
        <Link
          href={TAB_ROUTES.incidents}
          className={`px-4 py-2 font-mono text-xs tracking-wider uppercase border-b-2 -mb-px transition-colors ${activeTab === "incidents" ? "border-signal text-signal font-semibold" : "border-transparent text-slate hover:text-paper"}`}
        >
          HSE Incidents
        </Link>
      </div>

      {/* Tab Panels */}
      <div className="bg-ink-light border border-ink-mid rounded-sm overflow-hidden">
        {activeTab === "obligations" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                  <th className="p-4">Obligation</th>
                  <th className="p-4">Authority</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Responsible Person</th>
                  <th className="p-4">Due Date</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {obligations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate">No compliance obligations recorded in the registry.</td>
                  </tr>
                ) : (
                  obligations.map((o) => (
                    <tr key={o.id} className="hover:bg-ink-mid/10">
                      <td className="p-4 font-semibold text-paper">{o.title}</td>
                      <td className="p-4 font-mono text-signal">{o.authority}</td>
                      <td className="p-4 text-slate-light capitalize">{o.category}</td>
                      <td className="p-4 text-paper">{o.responsible_person || "—"}</td>
                      <td className="p-4 text-slate-light">{dateValue(o.due_date)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(o.status || 'pending')}`}>
                          {o.status || 'pending'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "employees" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                  <th className="p-4">Employee</th>
                  <th className="p-4">Credential</th>
                  <th className="p-4">Certificate Number</th>
                  <th className="p-4">Issuing Authority</th>
                  <th className="p-4">Expiry Date</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {empCredentials.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate">No employee credentials requiring assurance tracking.</td>
                  </tr>
                ) : (
                  empCredentials.map((c) => (
                    <tr key={c.id} className="hover:bg-ink-mid/10">
                      <td className="p-4 font-medium text-paper">{c.employee_name}</td>
                      <td className="p-4 text-paper">{c.certification_name}</td>
                      <td className="p-4 font-mono text-slate-light">{c.certificate_number || "—"}</td>
                      <td className="p-4 text-slate-light">{c.issuing_authority || "—"}</td>
                      <td className="p-4 text-slate-light">{dateValue(c.expires_on)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(c.status)}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "equipment" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                  <th className="p-4">Asset Code</th>
                  <th className="p-4">Asset Name</th>
                  <th className="p-4">Licence Type</th>
                  <th className="p-4">Certificate Number</th>
                  <th className="p-4">Expiry Date</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {eqCredentials.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate">No equipment licence credentials registered.</td>
                  </tr>
                ) : (
                  eqCredentials.map((c) => (
                    <tr key={c.id} className="hover:bg-ink-mid/10">
                      <td className="p-4 font-mono text-signal">{c.asset_code}</td>
                      <td className="p-4 font-medium text-paper">{c.asset_name}</td>
                      <td className="p-4 text-paper">{c.licence_type}</td>
                      <td className="p-4 font-mono text-slate-light">{c.certificate_number || "—"}</td>
                      <td className="p-4 text-slate-light">{dateValue(c.expires_on)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(c.status)}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "deployment-gates" && (
          <div className="space-y-6 p-4">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-paper">Active deployment requirements</h2>
                  <p className="mt-1 text-xs text-slate-light">These rules are enforced before workforce allocation and equipment operator deployment.</p>
                </div>
                <span className="font-mono text-xs text-slate">{deploymentRequirements.filter((r) => r.is_active).length} active</span>
              </div>
              <div className="overflow-x-auto border border-ink-mid">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                      <th className="p-3">Scope</th>
                      <th className="p-3">Credential</th>
                      <th className="p-3">Role / Equipment</th>
                      <th className="p-3">Project</th>
                      <th className="p-3">Verification</th>
                      <th className="p-3">Warning</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {deploymentRequirements.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-slate">No deployment compliance requirements configured.</td>
                      </tr>
                    ) : (
                      deploymentRequirements.map((r) => (
                        <tr key={r.id} className="hover:bg-ink-mid/10">
                          <td className="p-3 font-mono text-signal">{String(r.requirement_scope || "").replaceAll("_", " ")}</td>
                          <td className="p-3 font-semibold text-paper">{r.certification_name}</td>
                          <td className="p-3 text-slate-light">{r.target_role || r.equipment_type || "All deployments"}</td>
                          <td className="p-3 text-slate-light">{r.project_name || "All projects"}</td>
                          <td className="p-3 text-paper">{r.required_verification_status}</td>
                          <td className="p-3 text-slate-light">{r.warning_days} days</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${r.is_active ? statusClass("active") : statusClass("archived")}`}>
                              {r.is_active ? "active" : "archived"}
                            </span>
                          </td>
                          <td className="p-3">
                            {r.is_active ? (
                              <button onClick={() => handleArchiveRequirement(String(r.id))} className="text-xs font-semibold text-red-300 hover:text-red-200">
                                Archive
                              </button>
                            ) : (
                              <span className="text-xs text-slate">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-paper">Recent deployment gate checks</h2>
                  <p className="mt-1 text-xs text-slate-light">Audit trail of passed and blocked deployment decisions.</p>
                </div>
                <button onClick={() => void loadData()} className="flex items-center gap-2 text-xs font-semibold text-signal hover:text-signal/80">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>
              <div className="overflow-x-auto border border-ink-mid">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                      <th className="p-3">Time</th>
                      <th className="p-3">Gate</th>
                      <th className="p-3">Employee</th>
                      <th className="p-3">Project / Asset</th>
                      <th className="p-3">Result</th>
                      <th className="p-3">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-mid">
                    {deploymentGateChecks.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate">No deployment gate checks have been recorded yet.</td>
                      </tr>
                    ) : (
                      deploymentGateChecks.map((g) => {
                        const missing = Array.isArray(g.missing_requirements) ? g.missing_requirements : [];
                        return (
                          <tr key={g.id} className="hover:bg-ink-mid/10">
                            <td className="p-3 text-slate-light">{dateValue(g.checked_at)}</td>
                            <td className="p-3 font-mono text-signal">{String(g.gate_type || "").replaceAll("_", " ")}</td>
                            <td className="p-3 text-paper">{g.employee_name || g.employee_number || "Unknown employee"}</td>
                            <td className="p-3 text-slate-light">{g.project_name || g.asset_code || g.vehicle_registration || "General"}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(g.status)}`}>
                                {g.status}
                              </span>
                            </td>
                            <td className="p-3 text-xs text-slate-light">
                              {missing.length === 0 ? "Requirements satisfied" : missing.map((item: RecordData) => item.certification_name || item.reason).join(", ")}
                              {g.status === "override" && <span className="mt-1 block text-amber-300">Override: {g.override_reason || "Reason recorded"} {g.override_reference ? `· ${g.override_reference}` : ""}</span>}
                              {g.status === "blocked" && (
                                <button onClick={() => { setOverrideTarget(g); setOverrideForm({ reason: "", override_reference: "" }); }} className="mt-2 block text-xs font-semibold text-amber-300 hover:text-amber-200">
                                  Record controlled override
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === "corrective-actions" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                  <th className="p-4">Finding / Trigger</th>
                  <th className="p-4">Assigned To</th>
                  <th className="p-4">Due Date</th>
                  <th className="p-4">Priority</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {correctiveActions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-slate">No corrective actions (CAPA) logged.</td>
                  </tr>
                ) : (
                  correctiveActions.map((a) => (
                    <tr key={a.id} className="hover:bg-ink-mid/10">
                      <td className="p-4 font-semibold text-paper">{a.finding_trigger}</td>
                      <td className="p-4 text-paper">{a.responsible_person}</td>
                      <td className="p-4 text-slate-light">{dateValue(a.due_date)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(a.priority)}`}>
                          {a.priority}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(a.status)}`}>
                          {a.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "incidents" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
                  <th className="p-4">Incident Date</th>
                  <th className="p-4">Severity</th>
                  <th className="p-4">Description</th>
                  <th className="p-4">Logged By</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid">
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-slate">No safety incidents on record.</td>
                  </tr>
                ) : (
                  incidents.map((i) => (
                    <tr key={i.id} className="hover:bg-ink-mid/10">
                      <td className="p-4 text-paper">{dateValue(i.incident_date)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(i.severity)}`}>
                          {i.severity}
                        </span>
                      </td>
                      <td className="p-4 text-paper max-w-xs truncate">{i.description || i.daily_report}</td>
                      <td className="p-4 text-slate-light">Logged by System</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border border-emerald-500/30 bg-emerald-950/20 text-emerald-300">
                          Closed
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg border border-ink-mid bg-ink p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-amber-300">Controlled override</p>
                <h2 className="mt-1 text-lg font-semibold text-paper">Deployment gate override evidence</h2>
                <p className="mt-1 text-xs text-slate-light">Overrides do not erase missing credentials. They record formal authority, reason and reference before a restricted deployment can proceed outside normal compliance.</p>
              </div>
              <button onClick={() => setOverrideTarget(null)} className="text-slate hover:text-paper"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleOverrideGate} className="space-y-4">
              <div className="border border-ink-mid bg-ink-light p-3 text-xs text-slate-light">
                <p>Gate: {String(overrideTarget.gate_type || "").replaceAll("_", " ")}</p>
                <p className="mt-1">Subject: {overrideTarget.employee_name || overrideTarget.employee_number || "Unknown employee"}</p>
                <p className="mt-1">Missing: {Array.isArray(overrideTarget.missing_requirements) && overrideTarget.missing_requirements.length ? overrideTarget.missing_requirements.map((item: RecordData) => item.certification_name || item.reason).join(", ") : "Not recorded"}</p>
              </div>
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Authority reference</span>
                <input value={overrideForm.override_reference} onChange={(e) => setOverrideForm({ ...overrideForm, override_reference: e.target.value })} placeholder="e.g. MD-OVR-2026-001" className="w-full border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper outline-none focus:border-signal" />
              </label>
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Reason and mitigation</span>
                <textarea value={overrideForm.reason} onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })} rows={5} minLength={12} required placeholder="State who authorised the override, why deployment is necessary, and what mitigation/evidence applies." className="w-full resize-none border border-ink-mid bg-ink-light p-3 text-sm text-paper outline-none focus:border-signal" />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOverrideTarget(null)} className="border border-ink-mid px-4 py-2 text-sm text-slate-light hover:text-paper">Cancel</button>
                <button type="submit" disabled={overrideForm.reason.trim().length < 12} className="bg-amber-500 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">Record override</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Obligation Modal */}
      {showObligationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Record Obligation</span>
              <button onClick={() => setShowObligationModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateObligation} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Obligation Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q3 corporate tax filing"
                  value={obligationForm.title}
                  onChange={(e) => setObligationForm({ ...obligationForm, title: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Authority</label>
                  <select
                    value={obligationForm.authority}
                    onChange={(e) => setObligationForm({ ...obligationForm, authority: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="ZIMRA">ZIMRA</option>
                    <option value="NSSA">NSSA</option>
                    <option value="PRAZ">PRAZ</option>
                    <option value="CIFOZ">CIFOZ</option>
                    <option value="ZBCA">ZBCA</option>
                    <option value="ZIDA">ZIDA</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Category</label>
                  <select
                    value={obligationForm.category}
                    onChange={(e) => setObligationForm({ ...obligationForm, category: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="tax">Tax Compliance</option>
                    <option value="licencing">Asset Licencing</option>
                    <option value="procurement">PRAZ Registry</option>
                    <option value="insurance">Insurance Renewal</option>
                    <option value="corporate">Statutory Audits</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Due Date</label>
                  <input
                    type="date"
                    required
                    value={obligationForm.due_date}
                    onChange={(e) => setObligationForm({ ...obligationForm, due_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Responsible Person</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Auditor General"
                    value={obligationForm.responsible_person}
                    onChange={(e) => setObligationForm({ ...obligationForm, responsible_person: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Scope / Notes</label>
                <textarea
                  placeholder="Supporting notes or evidence requirements..."
                  value={obligationForm.notes}
                  onChange={(e) => setObligationForm({ ...obligationForm, notes: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50 h-20"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowObligationModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Add Obligation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deployment Requirement Modal */}
      {showRequirementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-2xl p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Add Deployment Gate Requirement</span>
              <button onClick={() => setShowRequirementModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateRequirement} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Gate Scope</label>
                  <select
                    value={requirementForm.requirement_scope}
                    onChange={(e) => setRequirementForm({ ...requirementForm, requirement_scope: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="equipment_assignment">Equipment operator assignment</option>
                    <option value="workforce_project_allocation">Workforce project allocation</option>
                    <option value="all_deployments">All deployments</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Required Credential</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Operator Certificate"
                    value={requirementForm.certification_name}
                    onChange={(e) => setRequirementForm({ ...requirementForm, certification_name: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Target Role</label>
                  <input
                    type="text"
                    placeholder="e.g. Site Agent"
                    value={requirementForm.target_role}
                    onChange={(e) => setRequirementForm({ ...requirementForm, target_role: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Equipment Type</label>
                  <input
                    type="text"
                    placeholder="e.g. Loader"
                    value={requirementForm.equipment_type}
                    onChange={(e) => setRequirementForm({ ...requirementForm, equipment_type: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Warning Days</label>
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    value={requirementForm.warning_days}
                    onChange={(e) => setRequirementForm({ ...requirementForm, warning_days: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Project Scope</label>
                  <select
                    value={requirementForm.project_id}
                    onChange={(e) => setRequirementForm({ ...requirementForm, project_id: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name || project.project_name || project.project_code}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Verification Status Required</label>
                  <select
                    value={requirementForm.required_verification_status}
                    onChange={(e) => setRequirementForm({ ...requirementForm, required_verification_status: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  >
                    <option value="verified">Verified</option>
                    <option value="pending">Pending</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
              </div>
              <div className="rounded border border-amber-500/30 bg-amber-950/10 p-3 text-xs leading-relaxed text-amber-100">
                New requirements are enforced immediately for planned and active workforce allocations and equipment assignments.
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowRequirementModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Create Requirement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Corrective Action Modal */}
      {showActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="bg-ink-light border border-ink-mid w-full max-w-md p-6 rounded-sm space-y-4">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3">
              <span className="text-base font-semibold text-paper">Record Corrective Action (CAPA)</span>
              <button onClick={() => setShowActionModal(false)} className="text-slate hover:text-paper">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCorrectiveAction} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Finding / Audit Trigger</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scaffolding inspection failure"
                  value={actionForm.finding_trigger}
                  onChange={(e) => setActionForm({ ...actionForm, finding_trigger: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Assigned To</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Site Safety Officer"
                    value={actionForm.responsible_person}
                    onChange={(e) => setActionForm({ ...actionForm, responsible_person: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono uppercase text-slate mb-1">Due Date</label>
                  <input
                    type="date"
                    required
                    value={actionForm.due_date}
                    onChange={(e) => setActionForm({ ...actionForm, due_date: e.target.value })}
                    className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-slate mb-1">Priority</label>
                <select
                  value={actionForm.priority}
                  onChange={(e) => setActionForm({ ...actionForm, priority: e.target.value })}
                  className="w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-3 border-t border-ink-mid">
                <button
                  type="button"
                  onClick={() => setShowActionModal(false)}
                  className="px-4 py-2 border border-ink-mid text-paper rounded text-sm hover:bg-ink-mid/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-signal text-ink font-semibold rounded text-sm hover:bg-signal/95"
                >
                  Issue Action
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
