"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Megaphone, Plus, Users, Workflow } from "lucide-react";
import {
  createCrmCampaign,
  createCrmMessageTemplate,
  getCrmCampaigns,
  getCrmLifecycleReport,
  getCrmMessageTemplates,
  getCrmNurtureSequences,
  createCrmNurtureSequence,
  updateCrmNurtureSequence,
  getCrmSequenceSteps,
  createCrmSequenceStep,
  sendCrmCampaign,
} from "@/lib/api";

type RecordData = Record<string, any>;

const inputClass = "w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-paper outline-none focus:border-signal";
const buttonClass = "inline-flex items-center gap-2 rounded bg-signal px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50";

export default function CRMMarketingPage() {
  const [campaigns, setCampaigns] = useState<RecordData[]>([]);
  const [templates, setTemplates] = useState<RecordData[]>([]);
  const [report, setReport] = useState<RecordData | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [campaignForm, setCampaignForm] = useState({ name: "", campaign_type: "tender_capture", source_channel: "website", status: "active" });
  const [templateForm, setTemplateForm] = useState({ name: "", channel: "email", subject: "", body: "" });
  const [sequences, setSequences] = useState<RecordData[]>([]);
  const [sequenceForm, setSequenceForm] = useState({ name: "", campaign_id: "", status: "draft" });
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [sequenceSteps, setSequenceSteps] = useState<RecordData[]>([]);
  const [stepForm, setStepForm] = useState({ step_order: "1", delay_days: "0", template_id: "", action_type: "log_message" });
  const [sendForm, setSendForm] = useState({ campaign_id: "", template_id: "" });
  const [sendResult, setSendResult] = useState<string | null>(null);

  const load = async () => {
    setWarnings([]);
    const [campaignRes, templateRes, reportRes, sequenceRes] = await Promise.allSettled([
      getCrmCampaigns(),
      getCrmMessageTemplates(),
      getCrmLifecycleReport(),
      getCrmNurtureSequences(),
    ]);
    const nextWarnings: string[] = [];
    if (campaignRes.status === "fulfilled" && campaignRes.value.success) setCampaigns(campaignRes.value.data || []);
    else nextWarnings.push("Campaigns could not be loaded from the CRM lifecycle service.");
    if (templateRes.status === "fulfilled" && templateRes.value.success) setTemplates(templateRes.value.data || []);
    else nextWarnings.push("Message templates could not be loaded from the CRM lifecycle service.");
    if (reportRes.status === "fulfilled" && reportRes.value.success) setReport(reportRes.value.data || null);
    else nextWarnings.push("Lifecycle reporting could not be loaded.");
    if (sequenceRes.status === "fulfilled" && sequenceRes.value.success) setSequences(sequenceRes.value.data || []);
    else nextWarnings.push("Nurture sequences could not be loaded from the CRM service.");
    setWarnings(nextWarnings);
  };

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(() => report?.summary || {}, [report]);
  const conversionRate = useMemo(() => {
    const leads = Number(summary.leads || 0);
    const qualified = Number(summary.qualified_leads || 0);
    return leads ? Math.round((qualified / leads) * 100) : 0;
  }, [summary]);

  const submitSendCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sendForm.campaign_id || !sendForm.template_id) return;
    setBusy(true);
    setSendResult(null);
    try {
      const response = await sendCrmCampaign(sendForm.campaign_id, sendForm.template_id);
      setSendResult(response?.message || `Sent to ${response?.data?.sent_count ?? 0} member(s).`);
    } catch (error) {
      setSendResult(`Send failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const submitCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await createCrmCampaign(campaignForm);
      if (!response?.data?.id) throw new Error("Campaign response did not include an id.");
      setCampaignForm({ name: "", campaign_type: "tender_capture", source_channel: "website", status: "active" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const submitTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await createCrmMessageTemplate({ ...templateForm, variables: [] });
      if (!response?.data?.id) throw new Error("Template response did not include an id.");
      setTemplateForm({ name: "", channel: "email", subject: "", body: "" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const submitSequence = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await createCrmNurtureSequence({
        name: sequenceForm.name,
        campaign_id: sequenceForm.campaign_id || null,
        status: sequenceForm.status,
      });
      if (!response?.data?.id) throw new Error("Nurture sequence response did not include an id.");
      setSequenceForm({ name: "", campaign_id: "", status: "draft" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleSequenceStatus = async (sequence: RecordData) => {
    setBusy(true);
    try {
      const nextStatus = sequence.status === "active" ? "paused" : "active";
      await updateCrmNurtureSequence(sequence.id, { name: sequence.name, status: nextStatus });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openSequenceSteps = async (sequenceId: string) => {
    setSelectedSequenceId(sequenceId);
    const res = await getCrmSequenceSteps(sequenceId);
    setSequenceSteps(res.success && Array.isArray(res.data) ? res.data : []);
  };

  const submitStep = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSequenceId) return;
    setBusy(true);
    try {
      const response = await createCrmSequenceStep(selectedSequenceId, {
        step_order: Number(stepForm.step_order) || 1,
        delay_days: Number(stepForm.delay_days) || 0,
        template_id: stepForm.template_id || null,
        action_type: stepForm.action_type,
      });
      if (!response?.data?.id) throw new Error("Sequence step response did not include an id.");
      setStepForm({ step_order: String((sequenceSteps.length || 0) + 2), delay_days: "0", template_id: "", action_type: "log_message" });
      await openSequenceSteps(selectedSequenceId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6">
      <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-light hover:text-signal">
        <ArrowLeft className="h-4 w-4" /> Back to CRM
      </Link>

      <div className="mt-6 flex flex-col gap-2">
        <h1 className="text-2xl font-black uppercase tracking-tight">CRM Marketing Command</h1>
        <p className="max-w-3xl text-sm text-slate-light">
          Campaign attribution, lead-source performance, and reusable outreach templates. This layer feeds the existing leads, opportunities, quotations, and communications modules.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="mt-5 rounded border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric icon={<Megaphone />} label="Campaigns" value={summary.campaigns ?? campaigns.length} />
        <Metric icon={<Users />} label="Leads" value={summary.leads ?? 0} />
        <Metric icon={<BarChart3 />} label="Qualified Rate" value={`${conversionRate}%`} />
        <Metric icon={<BarChart3 />} label="Weighted Forecast" value={money(summary.weighted_forecast)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider">Create Campaign</h2>
          <form onSubmit={submitCampaign} className="mt-4 grid gap-3">
            <input className={inputClass} placeholder="Campaign name" value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} required />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input className={inputClass} placeholder="Type" value={campaignForm.campaign_type} onChange={(e) => setCampaignForm({ ...campaignForm, campaign_type: e.target.value })} />
              <input className={inputClass} placeholder="Source channel" value={campaignForm.source_channel} onChange={(e) => setCampaignForm({ ...campaignForm, source_channel: e.target.value })} />
              <select className={inputClass} value={campaignForm.status} onChange={(e) => setCampaignForm({ ...campaignForm, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" /> Create Campaign</button>
          </form>
          <RecordList rows={campaigns} columns={["name", "campaign_type", "source_channel", "status", "member_count", "converted_count"]} />

          <form onSubmit={submitSendCampaign} className="mt-4 grid gap-3 border-t border-white/10 pt-4">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-light"><Megaphone className="h-3.5 w-3.5" /> Send Campaign Outreach</h3>
            <select className={inputClass} value={sendForm.campaign_id} onChange={(e) => setSendForm({ ...sendForm, campaign_id: e.target.value })} required>
              <option value="">Select campaign...</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={inputClass} value={sendForm.template_id} onChange={(e) => setSendForm({ ...sendForm, template_id: e.target.value })} required>
              <option value="">Select template...</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button disabled={busy || !sendForm.campaign_id || !sendForm.template_id} className={buttonClass}>Send to Members</button>
            {sendResult && <p className="text-xs text-slate-light">{sendResult}</p>}
          </form>
        </section>

        <section className="rounded border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider">Message Templates</h2>
          <form onSubmit={submitTemplate} className="mt-4 grid gap-3">
            <input className={inputClass} placeholder="Template name" value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} required />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <select className={inputClass} value={templateForm.channel} onChange={(e) => setTemplateForm({ ...templateForm, channel: e.target.value })}>
                <option value="email">Email</option>
                <option value="whatsapp_message">WhatsApp</option>
                <option value="portal_message">Portal Message</option>
              </select>
              <input className={inputClass} placeholder="Subject" value={templateForm.subject} onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })} />
            </div>
            <textarea className={inputClass} placeholder="Template body" value={templateForm.body} onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })} required />
            <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" /> Create Template</button>
          </form>
          <RecordList rows={templates} columns={["name", "channel", "subject", "is_active"]} />
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded border border-white/10 bg-white/[0.03] p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider"><Workflow className="h-4 w-4" /> Nurture Sequences</h2>
          <form onSubmit={submitSequence} className="mt-4 grid gap-3">
            <input className={inputClass} placeholder="Sequence name" value={sequenceForm.name} onChange={(e) => setSequenceForm({ ...sequenceForm, name: e.target.value })} required />
            <div className="grid grid-cols-2 gap-3">
              <select className={inputClass} value={sequenceForm.campaign_id} onChange={(e) => setSequenceForm({ ...sequenceForm, campaign_id: e.target.value })}>
                <option value="">No linked campaign</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className={inputClass} value={sequenceForm.status} onChange={(e) => setSequenceForm({ ...sequenceForm, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" /> Create Sequence</button>
          </form>

          <div className="mt-5 space-y-2">
            {sequences.length === 0 && <p className="rounded border border-dashed border-white/10 p-5 text-center text-sm text-slate-light">No nurture sequences recorded.</p>}
            {sequences.map((seq) => (
              <div key={seq.id} className={`rounded border p-3 text-xs ${selectedSequenceId === seq.id ? "border-signal" : "border-white/10"}`}>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => openSequenceSteps(seq.id)} className="text-left font-semibold text-paper hover:text-signal">
                    {seq.name}
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-white/10 px-2 py-0.5 uppercase">{seq.step_count ?? 0} steps</span>
                    <button type="button" onClick={() => toggleSequenceStatus(seq)} disabled={busy} className="rounded bg-signal/20 px-2 py-0.5 uppercase text-signal">
                      {seq.status}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider">Sequence Steps</h2>
          {!selectedSequenceId ? (
            <p className="mt-4 rounded border border-dashed border-white/10 p-5 text-center text-sm text-slate-light">Select a sequence to view or add steps.</p>
          ) : (
            <>
              <form onSubmit={submitStep} className="mt-4 grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" min={1} className={inputClass} placeholder="Step order" value={stepForm.step_order} onChange={(e) => setStepForm({ ...stepForm, step_order: e.target.value })} required />
                  <input type="number" min={0} className={inputClass} placeholder="Delay (days)" value={stepForm.delay_days} onChange={(e) => setStepForm({ ...stepForm, delay_days: e.target.value })} />
                </div>
                <select className={inputClass} value={stepForm.template_id} onChange={(e) => setStepForm({ ...stepForm, template_id: e.target.value })}>
                  <option value="">No template (log-only step)</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select className={inputClass} value={stepForm.action_type} onChange={(e) => setStepForm({ ...stepForm, action_type: e.target.value })}>
                  <option value="log_message">Log message</option>
                  <option value="send_template">Send template</option>
                  <option value="create_activity">Create follow-up activity</option>
                </select>
                <button disabled={busy} className={buttonClass}><Plus className="h-4 w-4" /> Add Step</button>
              </form>
              <RecordList rows={sequenceSteps} columns={["step_order", "delay_days", "action_type", "template_id"]} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return <div className="rounded border border-white/10 bg-white/[0.03] p-4"><div className="mb-3 h-5 w-5 text-signal">{icon}</div><p className="text-xs uppercase tracking-wider text-slate-light">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>;
}

function RecordList({ rows, columns }: { rows: RecordData[]; columns: string[] }) {
  return <div className="mt-5 overflow-hidden rounded border border-white/10"><table className="w-full text-left text-xs"><thead className="bg-white/5 text-slate-light">{<tr>{columns.map((column) => <th key={column} className="p-2 uppercase">{column.replaceAll("_", " ")}</th>)}</tr>}</thead><tbody>{rows.slice(0, 8).map((row) => <tr key={row.id} className="border-t border-white/5">{columns.map((column) => <td key={column} className="p-2">{String(row[column] ?? "-")}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-center text-sm text-slate-light">No production campaigns recorded.</p>}</div>;
}

function money(value: unknown) {
  const amount = Number(value || 0);
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
