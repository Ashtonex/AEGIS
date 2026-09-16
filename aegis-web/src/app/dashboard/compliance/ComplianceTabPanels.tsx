"use client";

import { RefreshCw } from "lucide-react";
import { dateValue, statusClass } from "./page";

type RecordData = Record<string, any>;

export function EmployeesTab({ empCredentials }: { empCredentials: RecordData[] }) {
  return (
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
  );
}

export function EquipmentTab({ eqCredentials }: { eqCredentials: RecordData[] }) {
  return (
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
  );
}

export function DeploymentGatesTab({
  deploymentRequirements, deploymentGateChecks, onArchiveRequirement, onRefresh, onOverride,
}: {
  deploymentRequirements: RecordData[];
  deploymentGateChecks: RecordData[];
  onArchiveRequirement: (id: string) => void;
  onRefresh: () => void;
  onOverride: (gate: RecordData) => void;
}) {
  return (
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
                        <button onClick={() => onArchiveRequirement(String(r.id))} className="text-xs font-semibold text-red-300 hover:text-red-200">
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
          <button onClick={onRefresh} className="flex items-center gap-2 text-xs font-semibold text-signal hover:text-signal/80">
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
                          <button onClick={() => onOverride(g)} className="mt-2 block text-xs font-semibold text-amber-300 hover:text-amber-200">
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
  );
}

export function CorrectiveActionsTab({ correctiveActions }: { correctiveActions: RecordData[] }) {
  return (
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
  );
}

export function IncidentsTab({ incidents }: { incidents: RecordData[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-mid text-slate font-mono text-[11px] uppercase tracking-wider bg-ink bg-opacity-20">
            <th className="p-4">Incident Date</th>
            <th className="p-4">Title</th>
            <th className="p-4">Severity</th>
            <th className="p-4">Location</th>
            <th className="p-4">Description</th>
            <th className="p-4">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-mid">
          {incidents.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-4 text-center text-slate">No safety incidents on record.</td>
            </tr>
          ) : (
            incidents.map((i) => (
              <tr key={i.id} className="hover:bg-ink-mid/10">
                <td className="p-4 text-paper">{dateValue(i.incident_date)}</td>
                <td className="p-4 font-semibold text-paper">{i.title || "Untitled"}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(i.severity)}`}>
                    {i.severity}
                  </span>
                </td>
                <td className="p-4 text-slate-light">{i.location || "—"}</td>
                <td className="p-4 text-paper max-w-xs truncate">{i.description || "—"}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded-sm text-[10px] uppercase font-mono tracking-wider border ${statusClass(i.status || "open")}`}>
                    {i.status || "open"}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
