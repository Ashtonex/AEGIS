"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, Building2, ExternalLink, Phone, Mail, Plus, 
  Search, Filter, ShieldAlert, DollarSign, GitBranch, 
  ChevronDown, ChevronRight, Loader2, CheckCircle2, Globe, MapPin,
  MessageSquare, Clock, PlusSquare, FileText, UserPlus, AlertCircle, Save
} from 'lucide-react';
import { 
  getCrmOrganizations, 
  createCrmOrganization, 
  updateCrmOrganization,
  getCrmContacts,
  getCrmActivities,
  createCrmActivity
} from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthContext';

interface Organization {
  id: string;
  name: string;
  industry?: string;
  sector?: string; // Mining, Government, Private
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  registration_number?: string;
  tax_id?: string;
  credit_limit?: number | string;
  total_contract_value?: number | string;
  risk_rating?: string; // Low, Medium, High
  active_projects_count?: number;
  parent_org_id?: string;
  parent_name?: string;
  subsidiaries?: Organization[];
}

interface Contact {
  id: string;
  contact_name: string;
  job_title?: string;
  email?: string;
  phone?: string;
  whatsapp_preference?: boolean;
  linkedin?: string;
  client_org_id?: string;
  company_name?: string;
}

interface Activity {
  id: string;
  contact_id?: string;
  type: string;
  subject: string;
  description?: string;
  activity_date?: string;
  status?: string;
  contact_name?: string;
}

export default function ClientOrganizationsRegistry() {
  const { session } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  
  // UI states
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('All');
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Form states - Create Account
  const [form, setForm] = useState({
    name: '',
    industry: '',
    sector: 'Private',
    website: '',
    phone: '',
    email: '',
    address: '',
    registration_number: '',
    tax_id: '',
    credit_limit: 0,
    total_contract_value: 0,
    risk_rating: 'Medium',
    parent_org_id: ''
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Inline forms for Right Detail Panel
  const [isSavingLimits, setIsSavingLimits] = useState(false);
  const [limitsForm, setLimitsForm] = useState({
    credit_limit: 0,
    risk_rating: 'Medium'
  });

  const [isLoggingActivity, setIsLoggingActivity] = useState(false);
  const [activityForm, setActivityForm] = useState({
    type: 'Email',
    subject: '',
    description: '',
    contact_id: '',
    status: 'Completed'
  });
  const [activityFormErrors, setActivityFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [orgsRes, contactsRes, activitiesRes] = await Promise.allSettled([
          getCrmOrganizations(),
          getCrmContacts(),
          getCrmActivities()
        ]);

        let loadedOrgs: Organization[] = [];
        const warnings: string[] = [];
        if (orgsRes.status === 'fulfilled' && orgsRes.value.success && Array.isArray(orgsRes.value.data)) {
          loadedOrgs = orgsRes.value.data;
        } else {
          warnings.push("Client organizations could not be loaded from the CRM service.");
        }
        setOrgs(loadedOrgs);

        if (loadedOrgs.length > 0) {
          setSelectedOrgId(loadedOrgs[0].id);
        }

        if (contactsRes.status === 'fulfilled' && contactsRes.value.success && Array.isArray(contactsRes.value.data)) {
          setContacts(contactsRes.value.data);
        } else {
          setContacts([]);
          warnings.push("CRM contacts could not be loaded.");
        }

        if (activitiesRes.status === 'fulfilled' && activitiesRes.value.success && Array.isArray(activitiesRes.value.data)) {
          setActivities(activitiesRes.value.data);
        } else {
          setActivities([]);
          warnings.push("CRM activities could not be loaded.");
        }
        setSourceWarnings(warnings);
      } catch (err) {
        console.warn("Client organization data failed to load:", err);
        setError("Client organizations could not be loaded from the CRM service.");
        setOrgs([]);
        setContacts([]);
        setActivities([]);
        setSelectedOrgId(null);
        setSourceWarnings([]);
      } finally {
        setIsLoading(false);
      }
    }
    
    void loadData();
  }, [session]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Sync details when selectedOrg changes
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  useEffect(() => {
    if (selectedOrg) {
      setLimitsForm({
        credit_limit: Number(selectedOrg.credit_limit || 0),
        risk_rating: selectedOrg.risk_rating || 'Medium'
      });
      // Pick first contact of this org as default for logging activities
      const orgContacts = contacts.filter(c => c.client_org_id === selectedOrg.id);
      setActivityForm(prev => ({
        ...prev,
        contact_id: orgContacts.length > 0 ? orgContacts[0].id : '',
        subject: '',
        description: ''
      }));
    }
  }, [selectedOrg, contacts]);

  const toggleExpand = (id: string) => {
    setExpandedOrgs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Modify Credit Limits & Risk Rating
  const handleSaveLimits = async () => {
    if (!selectedOrgId) return;
    setIsSavingLimits(true);
    try {
      const response = await updateCrmOrganization(selectedOrgId, {
        credit_limit: Number(limitsForm.credit_limit),
        risk_rating: limitsForm.risk_rating
      });
      if (response && response.success) {
        setOrgs(prev => prev.map(o => o.id === selectedOrgId ? { 
          ...o, 
          credit_limit: limitsForm.credit_limit, 
          risk_rating: limitsForm.risk_rating 
        } : o));
        showToast("Credit parameters and risk metrics saved successfully.");
      } else {
        throw new Error("API call unsuccessful");
      }
    } catch (err) {
      showToast("Credit limits were not saved. Check the CRM service connection and retry.", "error");
    } finally {
      setIsSavingLimits(false);
    }
  };

  // Add Inline Contact Activity
  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityForm.contact_id) {
      showToast("You must select an associated contact to log an activity.", "error");
      return;
    }
    if (!activityForm.subject.trim()) {
      showToast("Activity subject is required.", "error");
      return;
    }

    setIsLoggingActivity(true);
    try {
      const response = await createCrmActivity({
        contact_id: activityForm.contact_id,
        type: activityForm.type,
        subject: activityForm.subject.trim(),
        description: activityForm.description.trim() || undefined,
        status: activityForm.status,
        activity_date: new Date().toISOString()
      });
      if (!response?.data?.id) throw new Error("CRM activity response did not include an id.");

      const matchedContact = contacts.find(c => c.id === activityForm.contact_id);

      const newAct: Activity = {
        id: response.data.id,
        contact_id: activityForm.contact_id,
        contact_name: matchedContact?.contact_name || 'Associated Contact',
        type: activityForm.type,
        subject: activityForm.subject,
        description: activityForm.description,
        activity_date: new Date().toISOString(),
        status: activityForm.status
      };

      setActivities(prev => [newAct, ...prev]);
      showToast("CRM activity logged successfully.");
      setActivityForm(prev => ({
        ...prev,
        subject: '',
        description: ''
      }));
    } catch (err) {
      showToast("CRM activity was not logged. Check the CRM service connection and retry.", "error");
    } finally {
      setIsLoggingActivity(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Validation
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Organization name is required.';
    
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await createCrmOrganization({
        name: form.name.trim(),
        industry: form.industry.trim() || undefined,
        sector: form.sector,
        website: form.website.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        registration_number: form.registration_number.trim() || undefined,
        tax_id: form.tax_id.trim() || undefined,
        credit_limit: Number(form.credit_limit),
        total_contract_value: Number(form.total_contract_value),
        risk_rating: form.risk_rating,
        parent_org_id: form.parent_org_id || null
      });
      if (!response?.data?.id) throw new Error("CRM organization response did not include an id.");

      const newOrg: Organization = {
        id: response.data.id,
        ...form,
        active_projects_count: 0,
        parent_name: form.parent_org_id ? orgs.find(o => o.id === form.parent_org_id)?.name : undefined
      };

      setOrgs(prev => [newOrg, ...prev]);
      setSelectedOrgId(newOrg.id);
      setIsModalOpen(false);
      showToast("Account successfully registered.");
      setForm({
        name: '',
        industry: '',
        sector: 'Private',
        website: '',
        phone: '',
        email: '',
        address: '',
        registration_number: '',
        tax_id: '',
        credit_limit: 0,
        total_contract_value: 0,
        risk_rating: 'Medium',
        parent_org_id: ''
      });
    } catch (err) {
      showToast("Client account was not created. Check the CRM service connection and retry.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Corporate hierarchy builder
  const buildHierarchy = (flatOrgs: Organization[]): Organization[] => {
    const orgMap: Record<string, Organization & { subsidiaries: Organization[] }> = {};
    const roots: Organization[] = [];

    flatOrgs.forEach(org => {
      orgMap[org.id] = { ...org, subsidiaries: [] };
    });

    flatOrgs.forEach(org => {
      if (org.parent_org_id && orgMap[org.parent_org_id]) {
        orgMap[org.parent_org_id].subsidiaries.push(orgMap[org.id]);
      } else {
        roots.push(orgMap[org.id]);
      }
    });

    return roots;
  };

  const roots = buildHierarchy(orgs);

  // Filter organizations
  const filteredOrgs = orgs.filter(org => {
    const matchesSearch = org.name.toLowerCase().includes(search.toLowerCase()) || 
      (org.registration_number?.toLowerCase() || '').includes(search.toLowerCase()) ||
      (org.industry?.toLowerCase() || '').includes(search.toLowerCase());
    
    const matchesSector = sectorFilter === 'All' || org.sector === sectorFilter;
    
    return matchesSearch && matchesSector;
  });

  const formatCurrency = (val: number | string | undefined) => {
    const num = Number(val);
    if (isNaN(num)) return '$0.00';
    return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  };

  const totalContractVal = orgs.reduce((acc, org) => acc + Number(org.total_contract_value || 0), 0);
  const totalCreditLimit = orgs.reduce((acc, org) => acc + Number(org.credit_limit || 0), 0);
  const totalActiveProjects = orgs.reduce((acc, org) => acc + (org.active_projects_count || 0), 0);

  // Extract selected org contacts and activities
  const selectedOrgContacts = selectedOrgId 
    ? contacts.filter(c => c.client_org_id === selectedOrgId) 
    : [];
  const selectedOrgContactIds = selectedOrgContacts.map(c => c.id);
  const selectedOrgActivities = activities.filter(act => 
    act.contact_id && selectedOrgContactIds.includes(act.contact_id)
  );

  return (
    <div className="min-h-screen bg-ink text-paper selection:bg-signal selection:text-ink">
      {/* Grid Overlay */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay"
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '32px 32px' }}
      />
      
      <div className="relative max-w-container mx-auto px-6 py-6 flex flex-col h-screen min-h-0 overflow-hidden">
        
        {/* Header */}
        <header className="shrink-0 mb-4">
          <Link href="/dashboard/crm" className="inline-flex items-center text-[10px] font-mono text-slate hover:text-signal transition-colors mb-2">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            BACK TO CRM ENGINE
          </Link>
          <div className="flex justify-between items-end border-b border-ink-mid pb-3">
            <div>
              <h1 className="font-sans font-black text-xl tracking-wide uppercase text-paper">Organizations & Corporate Accounts</h1>
              <p className="text-[10px] text-slate-light font-mono tracking-widest uppercase">Structured Account Tree, Credit Limit & Risk Telemetry</p>
            </div>
            <button 
              onClick={() => setIsModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 border border-signal hover:bg-signal/10 text-signal font-mono text-data-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>REGISTER ACCOUNT</span>
            </button>
          </div>
        </header>

        {/* Toast Toast Notifications */}
        {notification && (
          <div className={`fixed top-4 right-4 z-50 p-4 border rounded-sm font-mono text-xs shadow-lg animate-in fade-in slide-in-from-top-4 duration-300 ${
            notification.type === 'success' ? 'bg-ink-light border-signal text-signal' : 'bg-red-950 border-red-500 text-red-400'
          }`}>
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{notification.message}</span>
            </div>
          </div>
        )}

        {sourceWarnings.length > 0 && (
          <div className="mb-4 space-y-2 rounded border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
            {sourceWarnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p>{warning}</p>
              </div>
            ))}
          </div>
        )}

        {/* Analytics Summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 shrink-0">
          <div className="bg-ink-light border border-ink-mid p-3 rounded-none">
            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase">TOTAL ACCOUNTS</div>
            <div className="font-mono text-lg text-paper font-black tracking-tight mt-0.5">{orgs.length}</div>
          </div>
          <div className="bg-ink-light border border-ink-mid p-3 rounded-none">
            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase">CONTRACT EXPOSURE</div>
            <div className="font-mono text-lg text-signal font-black tracking-tight mt-0.5">{formatCurrency(totalContractVal)}</div>
          </div>
          <div className="bg-ink-light border border-ink-mid p-3 rounded-none">
            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase">CREDIT LIQUIDITY</div>
            <div className="font-mono text-lg text-paper font-black tracking-tight mt-0.5">{formatCurrency(totalCreditLimit)}</div>
          </div>
          <div className="bg-ink-light border border-ink-mid p-3 rounded-none">
            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase">ACTIVE PROJECTS</div>
            <div className="font-mono text-lg text-signal font-black tracking-tight mt-0.5">{totalActiveProjects}</div>
          </div>
        </section>

        {/* Toolbar & Filters */}
        <section className="bg-ink-light border border-ink-mid p-3 mb-4 flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-light" />
            <input 
              type="text" 
              placeholder="Search registry..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-ink border border-ink-mid pl-8 pr-3 py-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal transition-colors rounded-none"
            />
          </div>
          
          <div className="flex items-center space-x-1.5 w-full md:w-auto overflow-x-auto">
            <Filter className="w-3.5 h-3.5 text-slate flex-shrink-0" />
            {['All', 'Mining', 'Government', 'Private'].map((sector) => (
              <button
                key={sector}
                onClick={() => setSectorFilter(sector)}
                className={`px-2.5 py-0.5 font-mono text-[10px] transition-all border ${
                  sectorFilter === sector 
                    ? 'border-signal text-signal bg-signal/5 font-bold' 
                    : 'border-ink-mid text-slate hover:text-paper'
                }`}
              >
                {sector.toUpperCase()}
              </button>
            ))}
          </div>
        </section>

        {/* Main Workspace Layout (High-Density Split View) */}
        {isLoading ? (
          <div className="flex-1 flex justify-center items-center">
            <Loader2 className="w-8 h-8 text-signal animate-spin" />
          </div>
        ) : (
          <div className="flex-1 flex gap-4 min-h-0 overflow-hidden mb-2">
            
            {/* LEFT PANELS: HIGH DENSITY LIST DIRECTORY (60%) */}
            <div className="w-[58%] flex flex-col gap-4 min-h-0">
              
              {/* Directory Grid */}
              <div className="flex-1 bg-ink-light border border-ink-mid overflow-y-auto custom-scrollbar">
                <table className="w-full text-left border-collapse font-sans text-xs">
                  <thead>
                    <tr className="border-b border-ink-mid bg-ink/70 font-mono text-[10px] text-slate-light uppercase">
                      <th className="p-3 font-normal tracking-wider">Account Organization</th>
                      <th className="p-3 font-normal tracking-wider">Sector</th>
                      <th className="p-3 font-normal tracking-wider text-right">Contract Val</th>
                      <th className="p-3 font-normal tracking-wider text-right">Credit Limit</th>
                      <th className="p-3 font-normal tracking-wider text-center">Risk</th>
                      <th className="p-3 font-normal tracking-wider text-center">Proj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrgs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate font-mono">
                          NO REGISTRY ENTRIES MATCHING ACTIVE FILTER
                        </td>
                      </tr>
                    ) : (
                      filteredOrgs.map((org) => {
                        const isSelected = org.id === selectedOrgId;
                        const isHighRisk = org.risk_rating === 'High';
                        return (
                          <tr 
                            key={org.id} 
                            onClick={() => setSelectedOrgId(org.id)}
                            className={`border-b border-ink-mid/30 cursor-pointer transition-all ${
                              isSelected 
                                ? 'bg-ink border-l-2 border-l-signal' 
                                : 'hover:bg-ink/40'
                            }`}
                          >
                            <td className="p-3">
                              <div>
                                <div className={`font-bold text-sm leading-tight ${isSelected ? 'text-signal' : 'text-paper'}`}>
                                  {org.name}
                                </div>
                                <div className="font-mono text-[9px] text-slate-light mt-0.5 flex items-center space-x-1.5">
                                  <span>REG: {org.registration_number || 'N/A'}</span>
                                  {org.parent_name && (
                                    <span className="text-signal/70 flex items-center font-semibold">
                                      <GitBranch className="w-2.5 h-2.5 mr-0.5" />
                                      SUB
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-[10px] text-paper/80">
                              {org.sector?.toUpperCase() || 'PRIVATE'}
                            </td>
                            <td className="p-3 font-mono text-right text-signal font-semibold">
                              {formatCurrency(org.total_contract_value)}
                            </td>
                            <td className="p-3 font-mono text-right text-paper/85">
                              {formatCurrency(org.credit_limit)}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`px-1.5 py-0.5 font-mono text-[8px] uppercase border font-bold ${
                                org.risk_rating === 'Low' 
                                  ? 'bg-green-500/10 border-green-500/20 text-green-500' 
                                  : org.risk_rating === 'High'
                                  ? 'bg-red-500/10 border-red-500/20 text-red-400' 
                                  : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                              }`}>
                                {org.risk_rating || 'MEDIUM'}
                              </span>
                            </td>
                            <td className="p-3 text-center font-mono text-paper font-semibold">
                              {org.active_projects_count || 0}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Corporate Tree Sub-panel */}
              <div className="bg-ink-light border border-ink-mid p-3 shrink-0 h-44 overflow-y-auto custom-scrollbar">
                <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase border-b border-ink-mid pb-1.5 mb-2 flex items-center">
                  <GitBranch className="w-3.5 h-3.5 mr-1 text-signal" />
                  Corporate Structure Trees
                </h3>
                <div className="space-y-1.5 font-mono text-[11px] text-paper">
                  {roots.map((root) => {
                    const hasSubs = root.subsidiaries && root.subsidiaries.length > 0;
                    const isExpanded = !!expandedOrgs[root.id];
                    return (
                      <div key={root.id} className="border border-ink p-2 bg-ink/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1">
                            {hasSubs ? (
                              <button onClick={() => toggleExpand(root.id)} className="text-signal hover:text-white p-0.5">
                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </button>
                            ) : (
                              <span className="w-4" />
                            )}
                            <span className="font-bold text-paper">{root.name}</span>
                            <span className="text-[8px] px-1 bg-ink border border-ink-mid text-slate-light">{root.sector}</span>
                          </div>
                          <span className="text-signal font-semibold">{formatCurrency(root.total_contract_value)}</span>
                        </div>
                        {hasSubs && isExpanded && (
                          <div className="pl-4 mt-1.5 border-l border-ink-mid space-y-1">
                            {root.subsidiaries?.map(sub => (
                              <div key={sub.id} className="flex items-center justify-between p-1 bg-ink/10 text-[10px]">
                                <span className="text-slate-light">└─ {sub.name}</span>
                                <span className="text-slate">{formatCurrency(sub.total_contract_value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* RIGHT PANEL: SELECTED ORG DETAILS & ACTIVITIES (42%) */}
            <div className="w-[42%] flex flex-col bg-ink-light border border-ink-mid p-4 min-h-0 overflow-y-auto custom-scrollbar gap-4">
              
              {selectedOrg ? (
                <>
                  {/* Org Summary Meta */}
                  <div className="border-b border-ink-mid pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        <Building2 className="w-5 h-5 text-signal" />
                        <h2 className="font-sans font-black text-base text-paper leading-tight">{selectedOrg.name}</h2>
                      </div>
                      <span className="font-mono text-[9px] px-1.5 py-0.5 bg-ink border border-ink-mid text-slate-light uppercase">
                        {selectedOrg.industry || 'Infrastructure'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3 font-mono text-[10px] text-slate-light">
                      <div>
                        <span>REG: </span><span className="text-paper">{selectedOrg.registration_number || 'N/A'}</span>
                      </div>
                      <div>
                        <span>TID: </span><span className="text-paper">{selectedOrg.tax_id || 'N/A'}</span>
                      </div>
                      <div className="col-span-2">
                        <span>HQ: </span><span className="text-paper leading-tight">{selectedOrg.address || 'N/A'}</span>
                      </div>
                    </div>

                    <div className="flex space-x-2.5 mt-3 shrink-0">
                      {selectedOrg.website && (
                        <a 
                          href={selectedOrg.website} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="flex items-center space-x-1 text-[10px] font-mono px-2 py-1 bg-ink border border-ink-mid hover:border-signal text-signal transition-all"
                        >
                          <Globe className="w-3 h-3 text-slate-light" />
                          <span>WEBSITE</span>
                        </a>
                      )}
                      {selectedOrg.phone && (
                        <a 
                          href={`tel:${selectedOrg.phone}`}
                          className="flex items-center space-x-1 text-[10px] font-mono px-2 py-1 bg-ink border border-ink-mid text-paper"
                        >
                          <Phone className="w-3 h-3 text-slate-light" />
                          <span>{selectedOrg.phone}</span>
                        </a>
                      )}
                      {selectedOrg.email && (
                        <a 
                          href={`mailto:${selectedOrg.email}`}
                          className="flex items-center space-x-1 text-[10px] font-mono px-2 py-1 bg-ink border border-ink-mid text-paper"
                        >
                          <Mail className="w-3 h-3 text-slate-light" />
                          <span>EMAIL</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Associated Contacts list */}
                  <div>
                    <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-1.5 flex items-center justify-between">
                      <span>KEY ACCOUNT DECISION MAKERS</span>
                      <span className="text-signal text-[8px] font-bold">({selectedOrgContacts.length} ACTIVE)</span>
                    </h3>

                    {selectedOrgContacts.length === 0 ? (
                      <div className="border border-ink/40 bg-ink/10 p-3 text-center text-slate font-mono text-[10px] uppercase">
                        No contacts mapped to this account.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {selectedOrgContacts.map(c => (
                          <div key={c.id} className="bg-ink/30 border border-ink-mid/45 p-2 flex justify-between items-center text-xs">
                            <div>
                              <div className="font-bold text-paper">{c.contact_name}</div>
                              <div className="font-mono text-[9px] text-slate-light">{c.job_title || 'No Title'}</div>
                            </div>
                            <div className="flex items-center space-x-1.5">
                              {c.email && (
                                <a href={`mailto:${c.email}`} className="p-1 border border-ink bg-ink/55 text-slate hover:text-signal transition-colors">
                                  <Mail className="w-3 h-3" />
                                </a>
                              )}
                              {c.phone && (
                                <a href={`tel:${c.phone}`} className="p-1 border border-ink bg-ink/55 text-slate hover:text-signal transition-colors">
                                  <Phone className="w-3 h-3" />
                                </a>
                              )}
                              {c.whatsapp_preference && (
                                <span className="text-[8px] font-mono bg-green-500/10 border border-green-500/25 px-1 py-0.2 text-green-500 font-semibold">WA</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Database Grid Action: Modify Credit Limits & Risk */}
                  <div className="bg-ink p-3 border border-ink-mid/85 space-y-3">
                    <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase border-b border-ink-mid pb-1 flex items-center">
                      <ShieldAlert className="w-3.5 h-3.5 mr-1 text-signal" />
                      Risk Controls & Credit Registry (DB UPDATE)
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Credit Limit ($)</label>
                        <input 
                          type="number"
                          value={limitsForm.credit_limit}
                          onChange={(e) => setLimitsForm(prev => ({ ...prev, credit_limit: Number(e.target.value) }))}
                          className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Risk Assessment</label>
                        <select
                          value={limitsForm.risk_rating}
                          onChange={(e) => setLimitsForm(prev => ({ ...prev, risk_rating: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        >
                          <option value="Low">Low Risk</option>
                          <option value="Medium">Medium Risk</option>
                          <option value="High">High Risk</option>
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={handleSaveLimits}
                      disabled={isSavingLimits}
                      className="w-full py-1.5 bg-signal hover:bg-signal/90 text-black font-mono font-bold text-[10px] uppercase flex items-center justify-center space-x-1 disabled:opacity-50"
                    >
                      {isSavingLimits ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      <span>Save Parameters to Database</span>
                    </button>
                  </div>

                  {/* Direct Activity logger form */}
                  <form onSubmit={handleLogActivity} className="bg-ink p-3 border border-ink-mid/85 space-y-3">
                    <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase border-b border-ink-mid pb-1 flex items-center">
                      <PlusSquare className="w-3.5 h-3.5 mr-1 text-signal" />
                      Log Activity for Account
                    </h3>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Contact Target *</label>
                        <select
                          required
                          value={activityForm.contact_id}
                          onChange={(e) => setActivityForm(prev => ({ ...prev, contact_id: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        >
                          <option value="">Select Contact</option>
                          {selectedOrgContacts.map(c => (
                            <option key={c.id} value={c.id}>{c.contact_name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Medium / Type</label>
                        <select
                          value={activityForm.type}
                          onChange={(e) => setActivityForm(prev => ({ ...prev, type: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        >
                          <option value="Email">Email</option>
                          <option value="Call">Call</option>
                          <option value="Meeting">Meeting</option>
                          <option value="Task">Task</option>
                          <option value="Note">System Note</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-mono text-[9px] text-slate-light mb-0.5">Subject / Goal *</label>
                      <input 
                        type="text"
                        required
                        value={activityForm.subject}
                        onChange={(e) => setActivityForm(prev => ({ ...prev, subject: e.target.value }))}
                        placeholder="e.g. Price negotiation feedback call"
                        className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[9px] text-slate-light mb-0.5">Details / Takeaways</label>
                      <textarea
                        rows={2}
                        value={activityForm.description}
                        onChange={(e) => setActivityForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Key outcomes..."
                        className="w-full bg-ink-light border border-ink-mid p-1.5 font-sans text-xs text-paper focus:outline-none resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isLoggingActivity}
                      className="w-full py-1.5 bg-ink border border-signal hover:bg-signal/10 text-signal font-mono font-bold text-[10px] uppercase flex items-center justify-center space-x-1"
                    >
                      {isLoggingActivity && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1 text-slate" />}
                      <span>COMMIT ENGAGEMENT RECORD</span>
                    </button>
                  </form>

                  {/* Chronological Activity Timeline */}
                  <div>
                    <h3 className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-2 flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1 text-signal" />
                      Account Interaction History
                    </h3>

                    {selectedOrgActivities.length === 0 ? (
                      <div className="border border-ink/40 bg-ink/10 p-3 text-center text-slate font-mono text-[10px] uppercase">
                        No activity records on timeline.
                      </div>
                    ) : (
                      <div className="relative border-l border-ink-mid pl-3.5 space-y-3.5">
                        {selectedOrgActivities.map(act => {
                          const isEmail = act.type === 'Email';
                          const isCall = act.type === 'Call';
                          const isMeeting = act.type === 'Meeting';
                          return (
                            <div key={act.id} className="relative text-xs">
                              {/* Icon bullet */}
                              <span className={`absolute -left-[20px] top-0.5 w-3 h-3 rounded-full border bg-ink flex items-center justify-center ${
                                isEmail ? 'border-blue-400' : isCall ? 'border-yellow-400' : 'border-purple-400'
                              }`}>
                                <span className={`w-1 h-1 rounded-full ${
                                  isEmail ? 'bg-blue-400' : isCall ? 'bg-yellow-400' : 'bg-purple-400'
                                }`} />
                              </span>

                              <div className="flex justify-between items-start font-mono text-[9px] text-slate-light mb-0.5">
                                <span className="font-bold uppercase">{act.type} Log</span>
                                <span>{act.activity_date ? new Date(act.activity_date).toLocaleDateString() : 'N/A'}</span>
                              </div>

                              <div className="font-semibold text-paper leading-tight">{act.subject}</div>
                              {act.description && (
                                <p className="text-slate-light text-[10px] mt-0.5 leading-relaxed">{act.description}</p>
                              )}
                              <div className="text-[9px] text-slate mt-0.5 font-mono">
                                Engaged: {act.contact_name}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-slate font-mono text-xs">
                  <Building2 className="w-8 h-8 mb-2 opacity-30 text-signal" />
                  <span>SELECT ACCOUNT TO VIEW SUMMARY PROFILE</span>
                </div>
              )}

            </div>

          </div>
        )}

      </div>

      {/* Register Organization Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-ink-light border border-ink-mid w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-none p-6">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3 mb-4">
              <h3 className="font-sans font-black text-lg text-paper uppercase tracking-wider">Register Corporate Account</h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate hover:text-paper font-mono text-xs"
              >
                [ESC] CLOSE
              </button>
            </div>
            
            <form onSubmit={handleCreateOrg} className="space-y-3.5">
              <div>
                <label className="block font-mono text-data-sm text-slate-light mb-1">ORGANIZATION NAME *</label>
                <input 
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                />
                {formErrors.name && <p className="text-red-400 text-[10px] mt-1 font-mono">{formErrors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">SECTOR</label>
                  <select
                    value={form.sector}
                    onChange={(e) => setForm(prev => ({ ...prev, sector: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                  >
                    <option value="Mining">Mining</option>
                    <option value="Government">Government</option>
                    <option value="Private">Private</option>
                  </select>
                </div>
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">INDUSTRY</label>
                  <input 
                    type="text"
                    placeholder="e.g. Extraction, Transport"
                    value={form.industry}
                    onChange={(e) => setForm(prev => ({ ...prev, industry: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">REGISTRATION NUMBER</label>
                  <input 
                    type="text"
                    value={form.registration_number}
                    onChange={(e) => setForm(prev => ({ ...prev, registration_number: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  />
                </div>
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">TAX IDENTIFIER (TID/TIN)</label>
                  <input 
                    type="text"
                    value={form.tax_id}
                    onChange={(e) => setForm(prev => ({ ...prev, tax_id: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">CREDIT LIMIT ($)</label>
                  <input 
                    type="number"
                    value={form.credit_limit}
                    onChange={(e) => setForm(prev => ({ ...prev, credit_limit: Number(e.target.value) }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  />
                </div>
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">CONTRACT VALUE ($)</label>
                  <input 
                    type="number"
                    value={form.total_contract_value}
                    onChange={(e) => setForm(prev => ({ ...prev, total_contract_value: Number(e.target.value) }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">RISK RATING</label>
                  <select
                    value={form.risk_rating}
                    onChange={(e) => setForm(prev => ({ ...prev, risk_rating: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  >
                    <option value="Low">Low Risk</option>
                    <option value="Medium">Medium Risk</option>
                    <option value="High">High Risk</option>
                  </select>
                </div>
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">PARENT CORPORATION</label>
                  <select
                    value={form.parent_org_id}
                    onChange={(e) => setForm(prev => ({ ...prev, parent_org_id: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  >
                    <option value="">No Parent (Standalone)</option>
                    {orgs.filter(o => !o.parent_org_id).map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block font-mono text-data-sm text-slate-light mb-1">WEBSITE</label>
                  <input 
                    type="url"
                    placeholder="https://"
                    value={form.website}
                    onChange={(e) => setForm(prev => ({ ...prev, website: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">PHONE</label>
                  <input 
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-data-sm text-slate-light mb-1">EMAIL ADDRESS</label>
                <input 
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                />
              </div>

              <div>
                <label className="block font-mono text-data-sm text-slate-light mb-1">HEADQUARTERS ADDRESS</label>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm(prev => ({ ...prev, address: e.target.value }))}
                  className="w-full bg-ink border border-ink-mid p-2 font-sans text-xs text-paper focus:outline-none resize-none"
                />
              </div>

              <div className="flex justify-end space-x-3 border-t border-ink-mid pt-3 mt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 border border-ink-mid font-mono text-xs text-slate hover:text-paper"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center space-x-1.5 px-4 py-1.5 bg-signal hover:bg-signal/90 text-ink font-mono text-xs font-bold disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate" />}
                  <span>COMMIT ACCOUNT RECORD</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
