"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Target, Plus, Search, RefreshCw, X, Play, Settings, AlertTriangle, ArrowLeft } from 'lucide-react';
import { getCrmCampaigns } from '@/lib/api';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const res = await getCrmCampaigns();
        setCampaigns(res.success ? (res.data || []) : []);
      } catch {
        setCampaigns([]);
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <main className="min-h-screen bg-[#0A0D14] text-[#E2E8F0] p-4 lg:p-8 font-sans">
      <div className="flex items-center gap-4 border-b border-[#1E293B] pb-6 mb-6">
        <Link href="/dashboard/crm/marketing" className="p-2 rounded-lg bg-[#111827] border border-[#1E293B] hover:bg-[#1F2937] transition text-slate-400">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Target className="h-6 w-6 text-[#3B82F6]" />
            Marketing Campaigns
          </h1>
          <p className="text-slate-400 text-xs mt-1">Deploy, monitor, and scale outbound marketing initiatives.</p>
        </div>
      </div>

      <div className="bg-[#111827]/40 border border-[#1E293B]/60 p-6 rounded-xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-base font-semibold text-white">Active and Draft Campaigns</h2>
          <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white">
            <Plus className="h-4 w-4" />
            Create Campaign
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <RefreshCw className="h-8 w-8 animate-spin text-[#3B82F6]" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-xs">No campaigns yet. Create one to get started.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((camp: any) => (
              <div key={camp.id} className="bg-[#111827]/70 border border-[#1E293B] p-4 rounded-xl flex flex-col justify-between h-40">
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className="text-sm font-bold text-white line-clamp-1">{camp.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold ${
                      camp.status === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400'
                    }`}>{camp.status}</span>
                  </div>
                  <p className="text-slate-400 text-xs mt-2 font-mono">Channel: {camp.channel}</p>
                  <p className="text-slate-500 text-[10px] mt-1 font-mono">Segment: {camp.segment_name}</p>
                </div>
                <div className="flex justify-end gap-2 border-t border-[#1E293B] pt-3 mt-3">
                  <button className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#1E293B]">
                    <Settings className="h-4 w-4" />
                  </button>
                  <button className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded">
                    <Play className="h-3 w-3" />
                    Launch
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
