"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, Users, Mail, Phone, ExternalLink, Plus, Search, 
  Linkedin, CheckCircle2, Loader2, MessageSquare, PlusSquare, 
  Calendar, FileText, CheckSquare, Bell, Clock, Building2,
  Save, PhoneCall, Trash2, Edit2, AlertCircle
} from 'lucide-react';
import { 
  getCrmContacts, 
  createCrmContact, 
  updateCrmContact,
  getCrmOrganizations, 
  getCrmActivities, 
  createCrmActivity 
} from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthContext';

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

interface Organization {
  id: string;
  name: string;
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

export default function ContactsRegistry() {
  const { session } = useAuth();
  
  // Data states
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);

  // Search & Selected Contacts
  const [search, setSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  
  // Modals & Submits
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // Form states - Add Contact
  const [contactForm, setContactForm] = useState({
    contact_name: '',
    job_title: '',
    email: '',
    phone: '',
    whatsapp_preference: false,
    linkedin: '',
    client_org_id: ''
  });
  const [contactFormErrors, setContactFormErrors] = useState<Record<string, string>>({});

  // Inline forms - Edit Contact Profile & Log Activity
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    job_title: '',
    client_org_id: '',
    email: '',
    phone: '',
    whatsapp_preference: false
  });

  const [isLoggingActivity, setIsLoggingActivity] = useState(false);
  const [activityForm, setActivityForm] = useState({
    type: 'Email',
    subject: '',
    description: '',
    status: 'Completed'
  });
  const [activityFormErrors, setActivityFormErrors] = useState<Record<string, string>>({});

  function normalizeLoadError(reason: unknown) {
    const rawMessage = reason instanceof Error ? reason.message : String(reason ?? "");
    const normalizedMessage = rawMessage.toLowerCase();
    if (
      normalizedMessage.includes("signal is aborted") ||
      normalizedMessage.includes("operation was aborted") ||
      normalizedMessage.includes("aborterror") ||
      normalizedMessage.includes("timeouterror")
    ) {
      return "The CRM contacts feed is still synchronizing. Please retry once the connection is ready.";
    }
    return "Contacts could not be loaded from the CRM service.";
  }

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setError(null);
    try {
      const [contactsRes, orgsRes, activitiesRes] = await Promise.allSettled([
        getCrmContacts(),
        getCrmOrganizations(),
        getCrmActivities()
      ]);

      const warnings: string[] = [];
      let loadedOrgs: Organization[] = [];
      if (orgsRes.status === 'fulfilled' && orgsRes.value.success && Array.isArray(orgsRes.value.data)) {
        loadedOrgs = orgsRes.value.data;
        setOrganizations(loadedOrgs);
      } else {
        warnings.push("Client organizations could not be loaded.");
      }

      let loadedContacts: Contact[] = [];
      if (contactsRes.status === 'fulfilled' && contactsRes.value.success && Array.isArray(contactsRes.value.data)) {
        loadedContacts = contactsRes.value.data.map(c => ({
          ...c,
          company_name: c.company_name || loadedOrgs.find(o => o.id === c.client_org_id)?.name || 'Independent'
        }));
      } else {
        warnings.push("Contacts could not be loaded from the CRM service.");
      }
      setContacts(loadedContacts);

        if (loadedContacts.length > 0) {
          setSelectedContactId(loadedContacts[0].id);
        }

      if (activitiesRes.status === 'fulfilled' && activitiesRes.value.success && Array.isArray(activitiesRes.value.data)) {
        setActivities(activitiesRes.value.data);
      } else {
        setActivities([]);
        warnings.push("CRM activities could not be loaded.");
      }
      setSourceWarnings(warnings);
    } catch (err) {
      console.warn("Error loading contacts page data:", err);
      setError(normalizeLoadError(err));
      setContacts([]);
      setActivities([]);
      setSelectedContactId(null);
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

  const selectedContact = contacts.find(c => c.id === selectedContactId);

  // Sync Inline Forms when selectedContact changes
  useEffect(() => {
    if (selectedContact) {
      setProfileForm({
        job_title: selectedContact.job_title || '',
        client_org_id: selectedContact.client_org_id || '',
        email: selectedContact.email || '',
        phone: selectedContact.phone || '',
        whatsapp_preference: !!selectedContact.whatsapp_preference
      });
      setActivityForm({
        type: 'Email',
        subject: '',
        description: '',
        status: 'Completed'
      });
    }
  }, [selectedContact]);

  // Modify Profile parameters (DB update)
  const handleSaveProfile = async () => {
    if (!selectedContactId) return;
    setIsSavingProfile(true);
    try {
      const response = await updateCrmContact(selectedContactId, {
        job_title: profileForm.job_title,
        client_org_id: profileForm.client_org_id || null,
        email: profileForm.email,
        phone: profileForm.phone,
        whatsapp_preference: profileForm.whatsapp_preference
      });

      const matchedOrg = organizations.find(o => o.id === profileForm.client_org_id);

      if (response && response.success) {
        setContacts(prev => prev.map(c => c.id === selectedContactId ? {
          ...c,
          ...profileForm,
          company_name: matchedOrg?.name || 'Independent'
        } : c));
        showToast("Contact details saved to database registry.");
      } else {
        throw new Error("Update failed");
      }
    } catch (err) {
      showToast("Contact details were not saved. Check the CRM service connection and retry.", "error");
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Inline Log Activity for selected contact
  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContactId) return;
    if (!activityForm.subject.trim()) {
      showToast("Activity subject is required.", "error");
      return;
    }

    setIsLoggingActivity(true);
    try {
      const response = await createCrmActivity({
        contact_id: selectedContactId,
        type: activityForm.type,
        subject: activityForm.subject.trim(),
        description: activityForm.description.trim() || undefined,
        status: activityForm.status,
        activity_date: new Date().toISOString()
      });
      if (!response?.data?.id) throw new Error("CRM activity response did not include an id.");

      const newAct: Activity = {
        id: response.data.id,
        contact_id: selectedContactId,
        contact_name: selectedContact?.contact_name || 'Selected Contact',
        type: activityForm.type,
        subject: activityForm.subject,
        description: activityForm.description,
        activity_date: new Date().toISOString(),
        status: activityForm.status
      };

      setActivities(prev => [newAct, ...prev]);
      showToast("Activity logged on timeline.");
      setActivityForm(prev => ({
        ...prev,
        subject: '',
        description: ''
      }));
    } catch (err) {
      showToast("Activity was not logged. Check the CRM service connection and retry.", "error");
    } finally {
      setIsLoggingActivity(false);
    }
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const errors: Record<string, string> = {};
    if (!contactForm.contact_name.trim()) errors.contact_name = 'Name is required.';
    
    setContactFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await createCrmContact({
        contact_name: contactForm.contact_name.trim(),
        job_title: contactForm.job_title.trim() || undefined,
        email: contactForm.email.trim() || undefined,
        phone: contactForm.phone.trim() || undefined,
        whatsapp_preference: contactForm.whatsapp_preference,
        linkedin: contactForm.linkedin.trim() || undefined,
        client_org_id: contactForm.client_org_id || undefined
      });
      if (!response?.data?.id) throw new Error("CRM contact response did not include an id.");

      const matchedOrg = organizations.find(o => o.id === contactForm.client_org_id);
      const newContact: Contact = {
        id: response.data.id,
        ...contactForm,
        company_name: matchedOrg?.name || 'Independent'
      };

      setContacts(prev => [newContact, ...prev]);
      setSelectedContactId(newContact.id);
      setIsContactModalOpen(false);
      showToast("Contact added to registry.");
      setContactForm({
        contact_name: '',
        job_title: '',
        email: '',
        phone: '',
        whatsapp_preference: false,
        linkedin: '',
        client_org_id: ''
      });
    } catch (err) {
      showToast("Contact was not created. Check the CRM service connection and retry.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter contacts
  const filteredContacts = contacts.filter(c => {
    const matchesSearch = c.contact_name.toLowerCase().includes(search.toLowerCase()) ||
      (c.job_title?.toLowerCase() || '').includes(search.toLowerCase()) ||
      (c.company_name?.toLowerCase() || '').includes(search.toLowerCase()) ||
      (c.email?.toLowerCase() || '').includes(search.toLowerCase());
    return matchesSearch;
  });

  const totalContacts = contacts.length;
  const whatsappPreferredCount = contacts.filter(c => c.whatsapp_preference).length;
  const loggedActivitiesCount = activities.length;

  // Selected contact activity history
  const selectedContactActivities = selectedContactId
    ? activities.filter(a => a.contact_id === selectedContactId)
    : [];

  return (
    <div className="min-h-screen bg-ink text-paper selection:bg-signal selection:text-ink">
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
              <h1 className="font-sans font-black text-xl tracking-wide uppercase text-paper">Key Account Contacts</h1>
              <p className="text-[10px] text-slate-light font-mono tracking-widest uppercase">Decision-Maker Directory & Interaction History</p>
            </div>
            <button 
              onClick={() => setIsContactModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 border border-signal hover:bg-signal/10 text-signal font-mono text-data-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>ADD NEW CONTACT</span>
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

        {/* Analytics row */}
        <section className="grid grid-cols-3 gap-3 mb-4 shrink-0">
          <div className="bg-ink-light border border-ink-mid p-3">
            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-0.5">TOTAL DECISION MAKERS</div>
            <div className="font-mono text-lg text-paper font-black tracking-tight">{totalContacts}</div>
          </div>
          <div className="bg-ink-light border border-ink-mid p-3">
            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-0.5">WHATSAPP ENCRYPTED ACTIVE</div>
            <div className="font-mono text-lg text-signal font-black tracking-tight">
              {whatsappPreferredCount} <span className="text-slate-light text-xs">/ {totalContacts}</span>
            </div>
          </div>
          <div className="bg-ink-light border border-ink-mid p-3">
            <div className="font-mono text-[9px] text-slate-light tracking-widest uppercase mb-0.5">CRM INTERACTIONS LOGGED</div>
            <div className="font-mono text-lg text-paper font-black tracking-tight">{loggedActivitiesCount}</div>
          </div>
        </section>

        {/* Search */}
        <section className="bg-ink-light border border-ink-mid p-3 mb-4 shrink-0">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-light" />
            <input 
              type="text" 
              placeholder="Search contacts..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-ink border border-ink-mid pl-8 pr-3 py-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal transition-colors rounded-none"
            />
          </div>
        </section>

        {/* Main Grid Workspace: High-Density Split View */}
        {isLoading ? (
          <div className="flex-grow flex justify-center items-center">
            <Loader2 className="w-8 h-8 text-signal animate-spin" />
          </div>
        ) : (
          <div className="flex-grow flex gap-4 min-h-0 overflow-hidden mb-2">
            
            {/* LEFT COLUMN: HIGH DENSITY LIST DIRECTORY (58%) */}
            <div className="w-[58%] bg-ink-light border border-ink-mid overflow-y-auto custom-scrollbar">
              <table className="w-full text-left border-collapse font-sans text-xs">
                <thead>
                  <tr className="border-b border-ink-mid bg-ink/70 font-mono text-[10px] text-slate-light uppercase">
                    <th className="p-3 font-normal tracking-wider">Contact Profile</th>
                    <th className="p-3 font-normal tracking-wider">Company / Role</th>
                    <th className="p-3 font-normal tracking-wider text-center">Channels</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-slate font-mono uppercase">
                        NO KEY DECISION MAKERS REGISTERED
                      </td>
                    </tr>
                  ) : (
                    filteredContacts.map(contact => {
                      const isSelected = contact.id === selectedContactId;
                      return (
                        <tr 
                          key={contact.id} 
                          onClick={() => setSelectedContactId(contact.id)}
                          className={`border-b border-ink-mid/30 cursor-pointer transition-all ${
                            isSelected 
                              ? 'bg-ink border-l-2 border-l-signal' 
                              : 'hover:bg-ink/40'
                          }`}
                        >
                          <td className="p-3">
                            <div>
                              <div className={`font-bold text-sm leading-tight ${isSelected ? 'text-signal' : 'text-paper'}`}>
                                {contact.contact_name}
                              </div>
                              <div className="font-mono text-[9px] text-slate-light mt-0.5 flex items-center space-x-2">
                                {contact.email && (
                                  <span className="flex items-center">
                                    <Mail className="w-2.5 h-2.5 mr-0.5" />
                                    {contact.email}
                                  </span>
                                )}
                                {contact.phone && (
                                  <span className="flex items-center text-slate">
                                    <Phone className="w-2.5 h-2.5 mr-0.5" />
                                    {contact.phone}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-paper/85">{contact.company_name}</div>
                            <div className="font-mono text-[9px] text-slate-light mt-0.5 uppercase tracking-wider">
                              {contact.job_title || 'N/A'}
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              <span className={`px-1.5 py-0.5 font-mono text-[8px] border font-bold uppercase ${
                                contact.whatsapp_preference 
                                  ? 'bg-green-500/10 border-green-500/25 text-green-500' 
                                  : 'bg-ink border-ink-mid/45 text-slate'
                              }`}>
                                WA {contact.whatsapp_preference ? 'Active' : 'No'}
                              </span>
                              {contact.linkedin && (
                                <a 
                                  href={contact.linkedin} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-slate hover:text-signal p-1 bg-ink border border-ink-mid"
                                >
                                  <Linkedin className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* RIGHT COLUMN: DETAILED SUMMARY & TIMELINE (42%) */}
            <div className="w-[42%] flex flex-col bg-ink-light border border-ink-mid p-4 min-h-0 overflow-y-auto custom-scrollbar gap-4">
              {selectedContact ? (
                <>
                  {/* Profile Header Card */}
                  <div className="border-b border-ink-mid pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full bg-signal/15 border border-signal/25 flex items-center justify-center font-mono text-signal font-black text-sm">
                          {selectedContact.contact_name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <h2 className="font-sans font-black text-base text-paper leading-tight">{selectedContact.contact_name}</h2>
                          <p className="font-mono text-[9px] text-slate-light mt-0.5 uppercase tracking-wider">
                            {selectedContact.job_title || 'No Job Title'}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-[8px] bg-ink border border-ink-mid text-slate-light px-1.5 py-0.5">
                        ID: {selectedContact.id.substring(0, 8)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3 font-mono text-[10px] text-slate-light">
                      <div>
                        <span>Company: </span><span className="text-paper font-bold">{selectedContact.company_name}</span>
                      </div>
                      <div>
                        <span>WhatsApp: </span>
                        <span className={selectedContact.whatsapp_preference ? 'text-green-500 font-bold' : 'text-slate'}>
                          {selectedContact.whatsapp_preference ? 'PREFERRED' : 'NO PREF'}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span>Email: </span><a href={`mailto:${selectedContact.email}`} className="text-signal hover:underline">{selectedContact.email || 'N/A'}</a>
                      </div>
                      <div className="col-span-2">
                        <span>Phone: </span><a href={`tel:${selectedContact.phone}`} className="text-paper hover:underline">{selectedContact.phone || 'N/A'}</a>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {selectedContact.phone && (
                        <>
                          <a 
                            href={`tel:${selectedContact.phone}`}
                            className="flex items-center space-x-1 text-[9px] font-mono px-2 py-1 bg-ink border border-ink-mid hover:border-signal text-paper transition-all"
                          >
                            <PhoneCall className="w-3 h-3 text-slate-light" />
                            <span>DIAL CALL</span>
                          </a>
                          <a 
                            href={`https://wa.me/${selectedContact.phone.replace(/[^0-9]/g, '')}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center space-x-1 text-[9px] font-mono px-2 py-1 bg-ink border border-ink-mid hover:border-green-500 hover:text-green-500 text-paper transition-all"
                          >
                            <MessageSquare className="w-3 h-3 text-slate-light" />
                            <span>WHATSAPP DIRECT</span>
                          </a>
                        </>
                      )}
                      {selectedContact.linkedin && (
                        <a 
                          href={selectedContact.linkedin}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1 text-[9px] font-mono px-2 py-1 bg-ink border border-ink-mid hover:border-signal text-signal transition-all"
                        >
                          <Linkedin className="w-3 h-3" />
                          <span>LINKEDIN</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Modify Profile Card (DB update) */}
                  <div className="bg-ink p-3 border border-ink-mid/85 space-y-3">
                    <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase border-b border-ink-mid pb-1 flex items-center">
                      <Edit2 className="w-3.5 h-3.5 mr-1 text-signal" />
                      Modify Registry Parameters (DB UPDATE)
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Job Title</label>
                        <input 
                          type="text"
                          value={profileForm.job_title}
                          onChange={(e) => setProfileForm(prev => ({ ...prev, job_title: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1 font-mono text-xs text-paper focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Organization</label>
                        <select
                          value={profileForm.client_org_id}
                          onChange={(e) => setProfileForm(prev => ({ ...prev, client_org_id: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1 font-mono text-xs text-paper focus:outline-none"
                        >
                          <option value="">Independent (No Org)</option>
                          {organizations.map(org => (
                            <option key={org.id} value={org.id}>{org.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Email</label>
                        <input 
                          type="email"
                          value={profileForm.email}
                          onChange={(e) => setProfileForm(prev => ({ ...prev, email: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1 font-mono text-xs text-paper focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Phone</label>
                        <input 
                          type="text"
                          value={profileForm.phone}
                          onChange={(e) => setProfileForm(prev => ({ ...prev, phone: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1 font-mono text-xs text-paper focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <input 
                        type="checkbox"
                        id="whatsapp_pref_inline"
                        checked={profileForm.whatsapp_preference}
                        onChange={(e) => setProfileForm(prev => ({ ...prev, whatsapp_preference: e.target.checked }))}
                        className="w-3.5 h-3.5 text-signal bg-ink border-ink-mid"
                      />
                      <label htmlFor="whatsapp_pref_inline" className="font-mono text-[9px] text-paper">
                        WhatsApp Channels Preferred
                      </label>
                    </div>

                    <button
                      onClick={handleSaveProfile}
                      disabled={isSavingProfile}
                      className="w-full py-1.5 bg-signal hover:bg-signal/90 text-black font-mono font-bold text-[10px] uppercase flex items-center justify-center space-x-1"
                    >
                      {isSavingProfile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      <span>Save Profile to Database</span>
                    </button>
                  </div>

                  {/* Inline Activity Logger */}
                  <form onSubmit={handleLogActivity} className="bg-ink p-3 border border-ink-mid/85 space-y-3">
                    <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase border-b border-ink-mid pb-1 flex items-center">
                      <PlusSquare className="w-3.5 h-3.5 mr-1 text-signal" />
                      Log Activity for Contact
                    </h3>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Activity Type</label>
                        <select
                          value={activityForm.type}
                          onChange={(e) => setActivityForm(prev => ({ ...prev, type: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none"
                        >
                          <option value="Email">Email Outbound</option>
                          <option value="Call">Call Log</option>
                          <option value="Meeting">Meeting Log</option>
                          <option value="Task">Task Assigned</option>
                          <option value="Note">System Note</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-0.5">Status</label>
                        <select
                          value={activityForm.status}
                          onChange={(e) => setActivityForm(prev => ({ ...prev, status: e.target.value }))}
                          className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none"
                        >
                          <option value="Completed">Completed</option>
                          <option value="Pending">Scheduled / Pending</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-mono text-[9px] text-slate-light mb-0.5">Subject Heading *</label>
                      <input 
                        type="text"
                        required
                        placeholder="e.g. Discussed concrete mix adjustments"
                        value={activityForm.subject}
                        onChange={(e) => setActivityForm(prev => ({ ...prev, subject: e.target.value }))}
                        className="w-full bg-ink-light border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[9px] text-slate-light mb-0.5">Summary Notes</label>
                      <textarea
                        rows={2}
                        placeholder="Detail takeaways or task descriptions..."
                        value={activityForm.description}
                        onChange={(e) => setActivityForm(prev => ({ ...prev, description: e.target.value }))}
                        className="w-full bg-ink-light border border-ink-mid p-1.5 font-sans text-xs text-paper focus:outline-none resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isLoggingActivity}
                      className="w-full py-1.5 bg-ink border border-signal hover:bg-signal/10 text-signal font-mono font-bold text-[10px] uppercase flex items-center justify-center space-x-1"
                    >
                      {isLoggingActivity && <Loader2 className="w-3 h-3 animate-spin" />}
                      <span>COMMIT ENGAGEMENT LOG</span>
                    </button>
                  </form>

                  {/* History Timeline */}
                  <div>
                    <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase mb-2.5 flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1 text-signal animate-pulse" />
                      Decision-Maker Activity Log
                    </h3>

                    {selectedContactActivities.length === 0 ? (
                      <div className="border border-ink/40 bg-ink/10 p-3 text-center text-slate font-mono text-[10px] uppercase">
                        No interactions logged on contact timeline.
                      </div>
                    ) : (
                      <div className="relative border-l border-ink-mid pl-3.5 space-y-3.5">
                        {selectedContactActivities.map(act => {
                          const isEmail = act.type === 'Email';
                          const isCall = act.type === 'Call';
                          const isMeeting = act.type === 'Meeting';
                          return (
                            <div key={act.id} className="relative text-xs">
                              {/* Bullet circle */}
                              <span className={`absolute -left-[20px] top-0.5 w-3 h-3 rounded-full border bg-ink flex items-center justify-center ${
                                isEmail ? 'border-blue-400' : isCall ? 'border-yellow-400' : 'border-purple-400'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
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
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-slate font-mono text-xs">
                  <Users className="w-8 h-8 mb-2 opacity-30 text-signal" />
                  <span>SELECT A CONTACT FROM DIRECTORY TO VIEW PROFILE</span>
                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {/* Add Contact Modal */}
      {isContactModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-ink-light border border-ink-mid w-full max-w-lg max-h-[95vh] overflow-y-auto p-6 rounded-none">
            <div className="flex justify-between items-center border-b border-ink-mid pb-3 mb-4">
              <h3 className="font-sans font-black text-lg text-paper uppercase tracking-wider">Register Premium Contact</h3>
              <button 
                onClick={() => setIsContactModalOpen(false)} 
                className="text-slate hover:text-paper font-mono text-xs"
              >
                [ESC] CLOSE
              </button>
            </div>
            
            <form onSubmit={handleCreateContact} className="space-y-3.5">
              <div>
                <label className="block font-mono text-data-sm text-slate-light mb-1">CONTACT NAME *</label>
                <input 
                  type="text"
                  required
                  value={contactForm.contact_name}
                  onChange={(e) => setContactForm(prev => ({ ...prev, contact_name: e.target.value }))}
                  className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                />
                {contactFormErrors.contact_name && <p className="text-red-400 text-[10px] mt-1 font-mono">{contactFormErrors.contact_name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">JOB TITLE / ROLE</label>
                  <input 
                    type="text"
                    placeholder="e.g. Procurement Lead"
                    value={contactForm.job_title}
                    onChange={(e) => setContactForm(prev => ({ ...prev, job_title: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">CLIENT COMPANY</label>
                  <select
                    value={contactForm.client_org_id}
                    onChange={(e) => setContactForm(prev => ({ ...prev, client_org_id: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                  >
                    <option value="">Independent (No Org)</option>
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">EMAIL ADDRESS</label>
                  <input 
                    type="email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  />
                </div>
                <div>
                  <label className="block font-mono text-data-sm text-slate-light mb-1">PHONE NUMBER</label>
                  <input 
                    type="text"
                    value={contactForm.phone}
                    onChange={(e) => setContactForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-data-sm text-slate-light mb-1">LINKEDIN PROFILE URL</label>
                <input 
                  type="url"
                  placeholder="https://linkedin.com/in/..."
                  value={contactForm.linkedin}
                  onChange={(e) => setContactForm(prev => ({ ...prev, linkedin: e.target.value }))}
                  className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper"
                />
              </div>

              <div className="flex items-center space-x-2.5 bg-ink p-3 border border-ink-mid/45">
                <input 
                  type="checkbox"
                  id="whatsapp_preference"
                  checked={contactForm.whatsapp_preference}
                  onChange={(e) => setContactForm(prev => ({ ...prev, whatsapp_preference: e.target.checked }))}
                  className="w-4 h-4 text-signal bg-ink border-ink-mid"
                />
                <label htmlFor="whatsapp_preference" className="font-mono text-data-sm text-paper cursor-pointer select-none">
                  WhatsApp Direct preferred channels enabled for quick correspondence
                </label>
              </div>

              <div className="flex justify-end space-x-3 border-t border-ink-mid pt-3 mt-4">
                <button
                  type="button"
                  onClick={() => setIsContactModalOpen(false)}
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
                  <span>COMMIT CONTACT</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
