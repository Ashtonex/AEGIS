import React from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';

export default function SubcontractorRegistry() {
  const subs = [
    { name: 'SteelWorks Ltd', capability: 'Structural', tier: 1, compliance: 'Compliant', nssa: 'Valid', rating: 92 },
    { name: 'ZimPlumb Experts', capability: 'Plumbing', tier: 2, compliance: 'Pending', nssa: 'Expired', rating: 74 },
    { name: 'Apex Electrics', capability: 'Electrical', tier: 1, compliance: 'Compliant', nssa: 'Valid', rating: 88 },
  ];

  return (
    <div className="min-h-screen bg-ink text-paper selection:bg-signal selection:text-ink">
      <div 
        className="fixed inset-0 pointer-events-none opacity-5 mix-blend-overlay"
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '32px 32px' }}
      />
      
      <div className="relative max-w-container mx-auto px-6 py-8">
        
        {/* Header Section */}
        <header className="mb-8">
          <Link href="/dashboard/crm" className="inline-flex items-center text-data-sm font-mono text-slate hover:text-signal transition-colors mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            BACK TO CRM
          </Link>
          <div className="flex justify-between items-end border-b border-ink-mid pb-6">
            <div>
              <h1 className="font-display text-headline-xl tracking-tight text-paper mb-2">Subcontractor Registry</h1>
              <p className="text-body-sm text-slate-light font-mono tracking-widest uppercase">Asset-Light Scale Infrastructure</p>
            </div>
          </div>
        </header>

        {/* Data Grid */}
        <div className="bg-ink-light border border-ink-mid rounded-sm overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-ink-mid bg-ink/50">
                <th className="p-4 font-mono text-data-sm text-slate tracking-widest uppercase font-normal">Subcontractor Name</th>
                <th className="p-4 font-mono text-data-sm text-slate tracking-widest uppercase font-normal">Primary Capability</th>
                <th className="p-4 font-mono text-data-sm text-slate tracking-widest uppercase font-normal">Auth Tier</th>
                <th className="p-4 font-mono text-data-sm text-slate tracking-widest uppercase font-normal">Compliance</th>
                <th className="p-4 font-mono text-data-sm text-slate tracking-widest uppercase font-normal text-right">Reliability Score</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((sub, idx) => (
                <tr key={idx} className="border-b border-ink-mid/50 hover:bg-ink transition-colors cursor-pointer group">
                  <td className="p-4 font-display text-headline-md text-paper group-hover:text-signal transition-colors">{sub.name}</td>
                  <td className="p-4 text-body-sm text-slate-light">{sub.capability}</td>
                  <td className="p-4">
                    <span className="px-2 py-1 bg-ink border border-ink-mid font-mono text-[10px] text-slate-light">TIER {sub.tier}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center space-x-2">
                      {sub.compliance === 'Compliant' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : sub.compliance === 'Pending' ? (
                        <AlertCircle className="w-4 h-4 text-signal" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                      )}
                      <span className="font-mono text-data-label">{sub.compliance}</span>
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end space-x-3">
                      <span className="font-display text-headline-lg">{sub.rating}</span>
                      <div className="w-16 h-1 bg-ink border border-ink-mid">
                        <div className={`h-full ${sub.rating > 85 ? 'bg-green-500' : 'bg-signal'}`} style={{ width: `${sub.rating}%` }}></div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}