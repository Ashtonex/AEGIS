"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Target, Plus, RefreshCw, X, Play, Settings, AlertTriangle, Megaphone, Send, CheckCircle2 } from 'lucide-react';
import { getCrmCampaigns, createCrmCampaign, sendCrmCampaign, getCrmMessageTemplates } from '@/lib/api';
import { DashboardPageHeader } from '@/components/dashboard/DashboardPageHeader';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create Campaign Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignType, setCampaignType] = useState('tender_capture');
  const [sourceChannel, setSourceChannel] = useState('website');
  const [campaignBudget, setCampaignBudget] = useState('');
  const [campaignStatus, setCampaignStatus] = useState('active');

  // Launch Modal State
  const [launchingCampaign, setLaunchingCampaign] = useState<any | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [campRes, tempRes] = await Promise.allSettled([
        getCrmCampaigns(),
        getCrmMessageTemplates(),
      ]);
      if (campRes.status === 'fulfilled' && campRes.value.success) {
        setCampaigns(campRes.value.data || []);
      } else {
        setCampaigns([]);
      }
      if (tempRes.status === 'fulfilled' && tempRes.value.success) {
        setTemplates(tempRes.value.data || []);
      } else {
        setTemplates([]);
      }
    } catch {
      setCampaigns([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignName.trim()) return;

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const payload: Record<string, unknown> = {
        name: campaignName.trim(),
        campaign_type: campaignType,
        source_channel: sourceChannel,
        status: campaignStatus,
      };
      if (campaignBudget && !isNaN(Number(campaignBudget))) {
        payload.budget = Number(campaignBudget);
      }
      const res = await createCrmCampaign(payload);
      if (res.success) {
        setFeedback({ type: 'success', message: 'Campaign created successfully.' });
        setIsCreateOpen(false);
        setCampaignName('');
        setCampaignBudget('');
        await loadData();
      } else {
        setFeedback({ type: 'error', message: res.message || 'Failed to create campaign.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error creating campaign.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLaunchCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!launchingCampaign?.id || !selectedTemplateId) return;

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const res = await sendCrmCampaign(launchingCampaign.id, selectedTemplateId);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: res.message || `Dispatched to ${res.data?.sent_count ?? 0} recipients.`
        });
        setLaunchingCampaign(null);
        setSelectedTemplateId('');
        await loadData();
      } else {
        setFeedback({ type: 'error', message: res.message || 'Failed to launch campaign broadcast.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error sending campaign.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0A0D14] text-[#E2E8F0] p-4 lg:p-8 font-sans">
      <DashboardPageHeader
        backHref="/dashboard/crm/marketing"
        backLabel="Marketing Hub"
        eyebrow={{ label: "CRM Outbound Telemetry", icon: Target }}
        title="Marketing Campaigns"
        subtitle="Deploy, monitor, and scale outbound marketing initiatives and client broadcasts."
        actions={
          <Link
            href="/dashboard/crm/marketing"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 hover:border-signal/50 bg-white/[0.02] text-xs font-mono uppercase tracking-wider text-slate-300 rounded-sm"
          >
            <Megaphone className="w-3.5 h-3.5 text-signal" />
            Marketing Command
          </Link>
        }
      />

      {feedback && (
        <div
          className={`mb-4 p-3 rounded-sm text-xs font-mono flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="bg-[#111827]/40 border border-[#1E293B]/60 p-6 rounded-xl shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-base font-semibold text-white">Active and Draft Campaigns</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">Automated outreach, tender discovery broadcasts, and targeted sequences.</p>
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Campaign
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <RefreshCw className="h-8 w-8 animate-spin text-[#3B82F6]" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs font-mono">
            No campaigns registered yet. Click &quot;Create Campaign&quot; to initialize outbound marketing.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((camp: any) => (
              <div key={camp.id} className="bg-[#111827]/70 border border-[#1E293B] p-4 rounded-xl flex flex-col justify-between min-h-[160px] hover:border-white/20 transition-all">
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="text-sm font-bold text-white line-clamp-1">{camp.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${
                      camp.status === 'Active' || camp.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-slate-500/10 text-slate-400 border border-slate-700/50'
                    }`}>
                      {camp.status || 'Draft'}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mt-2 font-mono">Channel: {camp.source_channel || camp.channel || 'Direct'}</p>
                  <p className="text-slate-500 text-[10px] mt-1 font-mono">Type: {camp.campaign_type || 'General Outreach'}</p>
                  {camp.budget ? (
                    <p className="text-slate-400 text-[10px] mt-1 font-mono">Budget: ${Number(camp.budget).toLocaleString()}</p>
                  ) : null}
                </div>
                <div className="flex justify-end items-center gap-2 border-t border-[#1E293B] pt-3 mt-3">
                  <Link
                    href={`/dashboard/crm/marketing`}
                    title="Configure Nurture Sequences & Templates"
                    className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-[#1E293B] transition-colors"
                  >
                    <Settings className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => {
                      setLaunchingCampaign(camp);
                      setSelectedTemplateId(templates[0]?.id || '');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded transition-colors"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Launch
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CREATE CAMPAIGN MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsCreateOpen(false)} />
          <form
            onSubmit={handleCreateCampaign}
            className="relative bg-[#0F172A] border border-white/10 w-full max-w-md rounded-xl p-6 space-y-4 shadow-2xl z-10"
          >
            <div className="flex justify-between items-center pb-2 border-b border-white/10">
              <h2 className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-[#3B82F6]" />
                New Outbound Campaign
              </h2>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-mono uppercase text-[9px] mb-1">Campaign Name *</label>
                <input
                  required
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g. Q4 Mining Infrastructure Outreach"
                  className="w-full bg-black/50 border border-white/10 rounded-sm px-3 py-2 text-white outline-none focus:border-[#3B82F6]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-mono uppercase text-[9px] mb-1">Type</label>
                  <select
                    value={campaignType}
                    onChange={(e) => setCampaignType(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-sm px-2 py-2 text-white outline-none focus:border-[#3B82F6]"
                  >
                    <option value="tender_capture">Tender Capture</option>
                    <option value="lead_generation">Lead Generation</option>
                    <option value="client_reactivation">Reactivation</option>
                    <option value="event">Industry Event</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-mono uppercase text-[9px] mb-1">Channel</label>
                  <select
                    value={sourceChannel}
                    onChange={(e) => setSourceChannel(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-sm px-2 py-2 text-white outline-none focus:border-[#3B82F6]"
                  >
                    <option value="website">Website / Inbound</option>
                    <option value="email">Email Broadcast</option>
                    <option value="direct">Direct Sales</option>
                    <option value="referral">Partner Referral</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-mono uppercase text-[9px] mb-1">Budget ($ USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={campaignBudget}
                    onChange={(e) => setCampaignBudget(e.target.value)}
                    placeholder="e.g. 5000"
                    className="w-full bg-black/50 border border-white/10 rounded-sm px-3 py-2 text-white outline-none focus:border-[#3B82F6]"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-mono uppercase text-[9px] mb-1">Initial Status</label>
                  <select
                    value={campaignStatus}
                    onChange={(e) => setCampaignStatus(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-sm px-2 py-2 text-white outline-none focus:border-[#3B82F6]"
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 border border-white/10 text-slate-300 hover:text-white font-mono text-[10px] uppercase rounded-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !campaignName.trim()}
                className="px-5 py-2 bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-mono text-[10px] uppercase font-bold rounded-sm transition-colors"
              >
                {isSubmitting ? 'Creating...' : 'Initialize Campaign'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* LAUNCH BROADCAST MODAL */}
      {launchingCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setLaunchingCampaign(null)} />
          <form
            onSubmit={handleLaunchCampaign}
            className="relative bg-[#0F172A] border border-white/10 w-full max-w-md rounded-xl p-6 space-y-4 shadow-2xl z-10"
          >
            <div className="flex justify-between items-center pb-2 border-b border-white/10">
              <h2 className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-400" />
                Launch Campaign Broadcast
              </h2>
              <button type="button" onClick={() => setLaunchingCampaign(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-black/40 border border-white/5 p-3 rounded-sm text-xs">
              <span className="font-mono text-[9px] uppercase text-slate-400">Target Campaign</span>
              <p className="font-bold text-white text-sm mt-0.5">{launchingCampaign.name}</p>
            </div>

            <div className="space-y-3 text-xs">
              {templates.length > 0 ? (
                <div>
                  <label className="block text-slate-300 font-mono uppercase text-[9px] mb-1">Select Message Template *</label>
                  <select
                    required
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-sm px-3 py-2 text-white outline-none focus:border-[#3B82F6]"
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.channel || 'Email'})
                      </option>
                    ))}
                  </select>
                  <p className="font-mono text-[9px] text-slate-400 mt-1">
                    Templates define subject lines and body copy dispatched to enrolled campaign members.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-amber-950/20 border border-amber-500/20 text-amber-300 rounded-sm font-mono text-[10px]">
                  No message templates registered yet. Create one in{' '}
                  <Link href="/dashboard/crm/marketing" className="underline font-bold text-amber-200">
                    Marketing Hub
                  </Link>{' '}
                  before broadcasting.
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-white/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLaunchingCampaign(null)}
                className="px-4 py-2 border border-white/10 text-slate-300 hover:text-white font-mono text-[10px] uppercase rounded-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !selectedTemplateId || templates.length === 0}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-[10px] uppercase font-bold rounded-sm transition-colors"
              >
                {isSubmitting ? 'Dispatching...' : 'Confirm & Launch Broadcast'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
