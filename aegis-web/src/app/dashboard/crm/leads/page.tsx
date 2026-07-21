"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  Target, Zap, AlertTriangle, ShieldCheck, Clock, TrendingUp, 
  Building2, MapPin, Loader2, MessageSquare, Bot, FormInput, 
  Search, Eye, Linkedin, Inbox, Plus, Trash2, X, Copy, Check,
  Send, HelpCircle, CheckSquare, Sliders, ExternalLink, Lock,
  Filter, Globe, Database, UserCheck, RefreshCw, Layout, Smartphone
} from 'lucide-react';
import { getCrmLeads, getCrmTenderSignals, qualifyCrmLead, createCrmLead } from '@/lib/api';

// Define types based on our backend schema
interface Lead {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  sector: string;
  estimated_budget: number;
  ai_score: number;
  ai_rationale: string;
  lead_source: string;
  status: string;
  created_at: string;
}

interface ExternalProspectSignal {
  id: string;
  name: string;
  client: string;
  sector: string;
  budget: number;
  telemetry: string;
  risk: string;
  score: number;
  rationale: string;
}

interface ExternalTenderSignal {
  id: string;
  title: string;
  source: string;
  sector: string;
  budget: number;
  scrapedAt: string;
  ref: string;
  score: number;
  rationale: string;
  compliance: Array<{ label: string; status: string; desc: string }>;
}

interface ExternalLinkedInProfile {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  connection: string;
  email: string;
  phone: string;
  sector: string;
  avatarColor: string;
}

export default function CRMLeadsApp() {
  const [activeTab, setActiveTab] = useState<'inbox' | 'web_forms' | 'signal_bot' | 'prospector' | 'tender_scraping' | 'linkedin'>('inbox');
  
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [qualifyingId, setQualifyingId] = useState<string | null>(null);
  const [dismissedLeadIds, setDismissedLeadIds] = useState<string[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Lead Qualification Wizard States
  const [isQualifyWizardOpen, setIsQualifyWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardLead, setWizardLead] = useState<Lead | null>(null);

  // Wizard Step Form Data
  const [wizardOrg, setWizardOrg] = useState({
    name: '',
    sector: '',
    website: '',
    registration_number: '',
    tax_id: '',
    address: ''
  });

  const [wizardContact, setWizardContact] = useState({
    contact_name: '',
    email: '',
    phone: '',
    job_title: '',
    whatsapp_preference: false
  });

  const [wizardOpportunity, setWizardOpportunity] = useState({
    name: '',
    stage: 'Inquiry',
    budget: 0,
    probability: 0
  });

  const [wizardActivity, setWizardActivity] = useState({
    log_activity: false,
    type: 'Call',
    notes: '',
    due_date: '',
    due_time: '12:00'
  });

  // Open Wizard Helper
  const openQualifyWizard = (lead: Lead) => {
    setWizardLead(lead);
    setWizardStep(1);
    
    // Step 1: Pre-populate Org details
    setWizardOrg({
      name: lead.company_name || '',
      sector: lead.sector || '',
      website: '',
      registration_number: '',
      tax_id: '',
      address: ''
    });

    // Step 2: Pre-populate Contact details
    setWizardContact({
      contact_name: lead.contact_name || '',
      email: lead.contact_email || '',
      phone: lead.contact_phone || '',
      job_title: '',
      whatsapp_preference: false
    });

    // Step 3: Pre-populate Opportunity parameters
    setWizardOpportunity({
      name: lead.company_name ? `${lead.company_name} - ${lead.sector || 'General'} Project` : '',
      stage: 'Inquiry',
      budget: lead.estimated_budget || 0,
      probability: lead.ai_score || 0
    });

    // Step 4: Reset Activity scheduling
    setWizardActivity({
      log_activity: false,
      type: 'Call',
      notes: '',
      due_date: new Date().toISOString().split('T')[0], // default to today
      due_time: '12:00'
    });

    setIsQualifyWizardOpen(true);
  };

  // Wizard Submission Handler
  const handleWizardSubmit = async () => {
    if (!wizardLead) return;
    
    // Validate Step 1
    if (!wizardOrg.name.trim()) {
      showNotification("Company Name is required (Step 1).", "error");
      setWizardStep(1);
      return;
    }
    // Validate Step 2
    if (!wizardContact.contact_name.trim()) {
      showNotification("Contact Name is required (Step 2).", "error");
      setWizardStep(2);
      return;
    }
    // Validate Step 3
    if (!wizardOpportunity.name.trim()) {
      showNotification("Opportunity/Deal Name is required (Step 3).", "error");
      setWizardStep(3);
      return;
    }

    const payload = {
      organization: {
        name: wizardOrg.name.trim(),
        sector: wizardOrg.sector.trim() || null,
        website: wizardOrg.website.trim() || null,
        registration_number: wizardOrg.registration_number.trim() || null,
        tax_id: wizardOrg.tax_id.trim() || null,
        address: wizardOrg.address.trim() || null
      },
      contact: {
        contact_name: wizardContact.contact_name.trim(),
        email: wizardContact.email.trim() || null,
        phone: wizardContact.phone.trim() || null,
        job_title: wizardContact.job_title.trim() || null,
        whatsapp_preference: wizardContact.whatsapp_preference
      },
      opportunity: {
        name: wizardOpportunity.name.trim(),
        stage: wizardOpportunity.stage,
        budget: Number(wizardOpportunity.budget),
        probability: Number(wizardOpportunity.probability)
      },
      activity: wizardActivity.log_activity ? {
        type: wizardActivity.type,
        notes: wizardActivity.notes.trim() || null,
        due_date: wizardActivity.due_date ? `${wizardActivity.due_date}T${wizardActivity.due_time || '00:00'}:00` : null
      } : null
    };

    setQualifyingId(wizardLead.id);
    setIsQualifyWizardOpen(false); // Close modal
    try {
      const response = await qualifyCrmLead(wizardLead.id, payload);
      if (response.success) {
        showNotification("Lead qualified and converted to Opportunity!");
        setLeads(leads.filter(l => l.id !== wizardLead.id));
      } else {
        showNotification("Failed to qualify lead", "error");
      }
    } catch (error) {
      console.error("Failed to qualify", error);
      showNotification("Failed to qualify lead", "error");
    } finally {
      setQualifyingId(null);
      setWizardLead(null);
    }
  };

  const handleQualify = async (leadId: string) => {
    // Keep standard handler for fallback/direct integration
    setQualifyingId(leadId);
    try {
      const response = await qualifyCrmLead(leadId);
      if (response.success) {
        showNotification("Lead qualified and converted to Opportunity!");
        setLeads(leads.filter(l => l.id !== leadId));
      } else {
        showNotification("Failed to qualify lead", "error");
      }
    } catch (error) {
      console.error("Failed to qualify", error);
      showNotification("Failed to qualify lead", "error");
    } finally {
      setQualifyingId(null);
    }
  };

  // Manual Lead States
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualLeadData, setManualLeadData] = useState({
    company_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    sector: 'Civil',
    estimated_budget: '',
    lead_source: 'Manual'
  });
  const [isSubmittingManualLead, setIsSubmittingManualLead] = useState(false);

  // Web Form Simulator Input States
  const [formInputData, setFormInputData] = useState<Record<string, string>>({});
  const [isSubmittingWebForm, setIsSubmittingWebForm] = useState(false);

  // Fetch leads on mount
  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    setIsLoading(true);
    try {
      const response = await getCrmLeads();
      if (response.success && Array.isArray(response.data)) {
        setLeads(response.data);
      } else {
        setLeads([]);
      }
    } catch (error) {
      console.error("Error fetching leads", error);
      setLeads([]);
    } finally {
      setIsLoading(false);
    }
  };

  const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleDismiss = (leadId: string) => {
    setDismissedLeadIds(prev => [...prev, leadId]);
    showNotification("Lead dismissed locally.", "info");
  };

  const handleManualLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualLeadData.company_name.trim()) {
      showNotification("Company Name is required.", "error");
      return;
    }
    if (!manualLeadData.contact_name.trim()) {
      showNotification("Contact Name is required.", "error");
      return;
    }
    if (!manualLeadData.sector.trim()) {
      showNotification("Sector is required.", "error");
      return;
    }
    
    // Validate budget
    const budgetVal = parseFloat(manualLeadData.estimated_budget);
    if (isNaN(budgetVal) || budgetVal <= 0) {
      showNotification("Please enter a valid estimated budget greater than 0.", "error");
      return;
    }

    // Validate email if provided
    if (manualLeadData.contact_email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(manualLeadData.contact_email.trim())) {
        showNotification("Invalid email address format.", "error");
        return;
      }
    }

    // Validate phone if provided
    if (manualLeadData.contact_phone.trim()) {
      const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
      if (!phoneRegex.test(manualLeadData.contact_phone.trim())) {
        showNotification("Invalid phone number format.", "error");
        return;
      }
    }

    setIsSubmittingManualLead(true);
    try {
      const response = await createCrmLead({
        company_name: manualLeadData.company_name.trim(),
        contact_name: manualLeadData.contact_name.trim(),
        contact_email: manualLeadData.contact_email.trim() || undefined,
        contact_phone: manualLeadData.contact_phone.trim() || undefined,
        sector: manualLeadData.sector,
        estimated_budget: budgetVal,
        lead_source: manualLeadData.lead_source || 'Manual'
      });

      if (response.success) {
        showNotification("Manual Lead logged successfully!", "success");
        setManualLeadData({
          company_name: '',
          contact_name: '',
          contact_email: '',
          contact_phone: '',
          sector: 'Civil',
          estimated_budget: '',
          lead_source: 'Manual'
        });
        setIsManualModalOpen(false);
        fetchLeads();
      } else {
        showNotification("Failed to log manual lead. Please retry once the connection is ready.", "error");
      }
    } catch (error: any) {
      console.error(error);
      showNotification("Failed to log manual lead. Please retry once the connection is ready.", "error");
    } finally {
      setIsSubmittingManualLead(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[#D4AF37] border-[#D4AF37]/30 bg-[#D4AF37]/5';
    if (score >= 50) return 'text-slate-light border-[#1c1c1c] bg-[#111111]';
    return 'text-red-500 border-red-500/30 bg-red-500/5';
  };

  // ==========================================================================
  // STATE: WEB FORMS BUILDER
  // ==========================================================================
  const [formFields, setFormFields] = useState([
    { id: 'name', label: 'Contact Name', type: 'text', placeholder: 'Enter your full name', required: true, enabled: true },
    { id: 'email', label: 'Email Address', type: 'email', placeholder: 'name@company.com', required: true, enabled: true },
    { id: 'company', label: 'Company Name', type: 'text', placeholder: 'Organization name', required: true, enabled: true },
    { id: 'phone', label: 'Phone Number', type: 'tel', placeholder: '+263 ...', required: false, enabled: true },
    { id: 'project_type', label: 'Project Type', type: 'select', placeholder: 'Select project sector', required: true, enabled: true, options: ['Mining', 'Roads', 'Civil', 'Commercial'] },
    { id: 'message', label: 'Project Brief / Message', type: 'textarea', placeholder: 'Describe your project requirements...', required: false, enabled: true }
  ]);
  const [formTitle, setFormTitle] = useState("SNC Project Consultation Request");
  const [formButtonText, setFormButtonText] = useState("Initialize Telemetry");
  const [embedCodeTab, setEmbedCodeTab] = useState<'iframe' | 'script'>('iframe');
  const [copiedFormCode, setCopiedFormCode] = useState(false);

  const handleFormInputChange = (id: string, value: string) => {
    setFormInputData(prev => ({ ...prev, [id]: value }));
  };

  const handleWebFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const enabledFields = formFields.filter(f => f.enabled);

    // Validate required fields
    for (const field of enabledFields) {
      if (field.required && !formInputData[field.id]?.trim()) {
        showNotification(`${field.label} is required.`, "error");
        return;
      }
    }

    // Validate email format if email is enabled and not empty
    const emailField = enabledFields.find(f => f.id === 'email');
    if (emailField) {
      const emailVal = formInputData['email']?.trim();
      if (emailVal) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailVal)) {
          showNotification("Invalid email address format.", "error");
          return;
        }
      }
    }

    setIsSubmittingWebForm(true);
    try {
      const nameVal = formInputData['name']?.trim() || "Web Form Contact";
      const companyVal = formInputData['company']?.trim() || "Web Form Company";
      const emailVal = formInputData['email']?.trim();
      const phoneVal = formInputData['phone']?.trim();
      const sectorVal = formInputData['project_type']?.trim() || "Civil";

      const response = await createCrmLead({
        company_name: companyVal,
        contact_name: nameVal,
        contact_email: emailVal || undefined,
        contact_phone: phoneVal || undefined,
        sector: sectorVal,
        estimated_budget: 350000,
        lead_source: 'Web Form'
      });

      if (response.success) {
        showNotification("Web Form Lead registered in Inbox successfully!", "success");
        setFormInputData({});
        fetchLeads();
      } else {
        showNotification("Failed to submit web form. Please retry once the connection is ready.", "error");
      }
    } catch (error: any) {
      console.error("Web form submit error", error);
      showNotification("Failed to submit web form. Please retry once the connection is ready.", "error");
    } finally {
      setIsSubmittingWebForm(false);
    }
  };

  const toggleFieldEnabled = (id: string) => {
    setFormFields(formFields.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  };

  const toggleFieldRequired = (id: string) => {
    setFormFields(formFields.map(f => f.id === id ? { ...f, required: !f.required } : f));
  };

  const handleUpdateFieldPlaceholder = (id: string, placeholder: string) => {
    setFormFields(formFields.map(f => f.id === id ? { ...f, placeholder } : f));
  };

  const handleUpdateFieldLabel = (id: string, label: string) => {
    setFormFields(formFields.map(f => f.id === id ? { ...f, label } : f));
  };

  const enabledFieldIds = formFields.filter(f => f.enabled).map(f => f.id).join(',');
  const generatedIframeCode = `<iframe src="https://aegis.sixnine.construction/embed/forms/f_289a?title=${encodeURIComponent(formTitle)}&button=${encodeURIComponent(formButtonText)}&fields=${enabledFieldIds}" width="100%" height="450" style="border: 1px solid #1c1c1c; background: #050505;"></iframe>`;
  const generatedScriptCode = `<script src="https://aegis.sixnine.construction/js/form-loader.js" data-form-id="f_289a" data-title="${formTitle}" data-fields="${enabledFieldIds}" data-button="${formButtonText}"></script>`;

  const copyFormCode = () => {
    const code = embedCodeTab === 'iframe' ? generatedIframeCode : generatedScriptCode;
    navigator.clipboard.writeText(code);
    setCopiedFormCode(true);
    showNotification("Form embed code copied to clipboard.");
    setTimeout(() => setCopiedFormCode(false), 2000);
  };

  // ==========================================================================
  // STATE: SIGNAL BOT
  // ==========================================================================
  const [botGreeting, setBotGreeting] = useState("SNC Bot: Systems status nominal. Specify your heavy construction or mining infrastructure requirements.");
  const [botHours, setBotHours] = useState("07:00 - 18:00 CAT");
  const [botQuestions, setBotQuestions] = useState([
    "What is the name of your organization?",
    "Which sector describes your project (Mining, Roads, Civil, Commercial)?",
    "What is your target budget (USD)?",
    "What is your contact email or phone number?"
  ]);
  const [newQuestionInput, setNewQuestionInput] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ sender: 'bot' | 'user'; text: string }[]>([]);
  const [chatStep, setChatStep] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatAnswers, setChatAnswers] = useState<Record<number, string>>({});
  const [isSubmittingChatLead, setIsSubmittingChatLead] = useState(false);

  const startChatbotSimulator = () => {
    setIsChatOpen(true);
    const initialMsgs = [{ sender: 'bot' as const, text: botGreeting }];
    if (botQuestions.length > 0) {
      initialMsgs.push({ sender: 'bot' as const, text: botQuestions[0] });
    }
    setChatMessages(initialMsgs);
    setChatStep(0);
    setChatAnswers({});
  };

  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput.trim();
    const updatedMessages = [...chatMessages, { sender: 'user' as const, text: userText }];
    setChatMessages(updatedMessages);
    setChatInput("");

    const updatedAnswers = { ...chatAnswers, [chatStep]: userText };
    setChatAnswers(updatedAnswers);

    const nextStep = chatStep + 1;

    // Simulate typing
    setTimeout(async () => {
      if (nextStep < botQuestions.length) {
        setChatMessages(prev => [...prev, { sender: 'bot' as const, text: botQuestions[nextStep] }]);
        setChatStep(nextStep);
      } else {
        const contactDetails = updatedAnswers[3] || "";
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;

        const isValidEmail = emailRegex.test(contactDetails.trim());
        const isValidPhone = phoneRegex.test(contactDetails.trim());

        if (!isValidEmail && !isValidPhone) {
          setChatMessages(prev => [
            ...prev,
            { sender: 'bot' as const, text: "Error: Contact details could not be validated. Please enter a valid email address or phone number." }
          ]);
          showNotification("Invalid contact details format. Please provide a valid email or phone number.", "error");
          setChatStep(3);
          return;
        }

        setChatMessages(prev => [...prev, { sender: 'bot' as const, text: "Telemetry captured. Uploading signal to SNC Intelligence Grid..." }]);
        setIsSubmittingChatLead(true);
        try {
          const compName = updatedAnswers[0] || "Inbound Chatbot Org";
          const sec = updatedAnswers[1] || "Mining";
          const budgetVal = parseFloat(updatedAnswers[2].replace(/[^0-9.]/g, '')) || 250000;

          const response = await createCrmLead({
            company_name: compName,
            contact_name: "Inbound Chatbot Prospect",
            contact_email: isValidEmail ? contactDetails.trim() : undefined,
            contact_phone: isValidPhone ? contactDetails.trim() : undefined,
            sector: sec,
            estimated_budget: budgetVal,
            lead_source: "Signal Bot"
          });

          if (response.success) {
            setChatMessages(prev => [...prev, { sender: 'bot' as const, text: "Systems sync successful. Lead registered in SNC Leads Inbox. Propensity score calculated." }]);
            showNotification("Signal Bot Lead registered in Inbox.");
            fetchLeads();
          } else {
            setChatMessages(prev => [...prev, { sender: 'bot' as const, text: "Lead was not registered because the CRM service rejected the request. Please retry after checking the connection." }]);
          }
        } catch (err) {
          console.error("Failed to post chat lead", err);
          setChatMessages(prev => [...prev, { sender: 'bot' as const, text: "Lead was not registered because the CRM service connection failed. Please retry once the service is available." }]);
        } finally {
          setIsSubmittingChatLead(false);
        }
        setChatStep(botQuestions.length);
      }
    }, 800);
  };

  const handleAddQuestion = () => {
    if (!newQuestionInput.trim()) return;
    setBotQuestions([...botQuestions, newQuestionInput.trim()]);
    setNewQuestionInput("");
  };

  const handleRemoveQuestion = (index: number) => {
    setBotQuestions(botQuestions.filter((_, i) => i !== index));
  };

  // ==========================================================================
  // STATE: AI PROSPECTOR
  // ==========================================================================
  const externalProspects: ExternalProspectSignal[] = [];

  const [prospectsSearch, setProspectsSearch] = useState("");
  const [prospectsSectorFilter, setProspectsSectorFilter] = useState("All");
  const [minBudget, setMinBudget] = useState<number>(0);
  const [maxBudget, setMaxBudget] = useState<number>(50000000);
  const [importingProspectId, setImportingProspectId] = useState<string | null>(null);
  const [importedProspectIds, setImportedProspectIds] = useState<string[]>([]);

  const filteredProspects = externalProspects.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(prospectsSearch.toLowerCase()) || 
                          p.client.toLowerCase().includes(prospectsSearch.toLowerCase());
    const matchesSector = prospectsSectorFilter === 'All' || p.sector === prospectsSectorFilter;
    const matchesBudget = p.budget >= minBudget && p.budget <= maxBudget;
    return matchesSearch && matchesSector && matchesBudget;
  });

  const handleImportProspect = async (prospect: any) => {
    setImportingProspectId(prospect.id);
    try {
      const response = await createCrmLead({
        company_name: prospect.client,
        contact_name: prospect.name,
        sector: prospect.sector,
        estimated_budget: prospect.budget,
        lead_source: "AI Prospector",
        ai_score: prospect.score,
        ai_rationale: prospect.rationale
      });
      if (response.success) {
        showNotification(`Prospect "${prospect.name}" imported to Leads.`);
        setImportedProspectIds(prev => [...prev, prospect.id]);
        fetchLeads();
      } else {
        showNotification("Failed to import prospect", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Failed to import prospect", "error");
    } finally {
      setImportingProspectId(null);
    }
  };

  // ==========================================================================
  // STATE: TENDER SCRAPING Feed
  // ==========================================================================
  const [externalTenderSignals, setExternalTenderSignals] = useState<ExternalTenderSignal[]>([]);
  const [tenderSignalsLoading, setTenderSignalsLoading] = useState(false);
  const [tenderSignalsError, setTenderSignalsError] = useState<string | null>(null);
  const [lastTenderSignalsSync, setLastTenderSignalsSync] = useState<string | null>(null);
  const [tendersSectorFilter, setTendersSectorFilter] = useState("All");
  const [tendersSearch, setTendersSearch] = useState("");
  const [tendersMinBudget, setTendersMinBudget] = useState<number>(0);
  const [tendersMaxBudget, setTendersMaxBudget] = useState<number>(10000000);
  const [importingTenderId, setImportingTenderId] = useState<string | null>(null);
  const [importedTenderIds, setImportedTenderIds] = useState<string[]>([]);

  const loadTenderSignals = useCallback(async () => {
    setTenderSignalsLoading(true);
    setTenderSignalsError(null);
    try {
      const response = await getCrmTenderSignals({ includeInternalPublicFeed: true, limit: 12 });
      if (response.success && Array.isArray(response.data)) {
        setExternalTenderSignals(response.data);
        setLastTenderSignalsSync(new Date().toISOString());
      } else {
        setExternalTenderSignals([]);
        setTenderSignalsError("Tender signals could not be loaded from the CRM service.");
      }
    } catch (error) {
      console.error("Error fetching tender signals", error);
      setExternalTenderSignals([]);
      setTenderSignalsError("Tender signals could not be loaded from the CRM service.");
    } finally {
      setTenderSignalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'tender_scraping' && externalTenderSignals.length === 0 && !tenderSignalsLoading) {
      loadTenderSignals();
    }
  }, [activeTab, externalTenderSignals.length, tenderSignalsLoading, loadTenderSignals]);

  const filteredTenders = externalTenderSignals.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(tendersSearch.toLowerCase()) || 
                          t.source.toLowerCase().includes(tendersSearch.toLowerCase()) ||
                          t.ref.toLowerCase().includes(tendersSearch.toLowerCase());
    const matchesSector = tendersSectorFilter === 'All' || t.sector === tendersSectorFilter;
    const matchesBudget = t.budget >= tendersMinBudget && t.budget <= tendersMaxBudget;
    return matchesSearch && matchesSector && matchesBudget;
  });

  const handleImportTender = async (tender: any) => {
    setImportingTenderId(tender.id);
    try {
      const response = await createCrmLead({
        company_name: tender.source,
        contact_name: tender.title,
        sector: tender.sector,
        estimated_budget: tender.budget,
        lead_source: "Tender Scraper",
        ai_score: tender.score,
        ai_rationale: tender.rationale
      });
      if (response.success) {
        showNotification(`Tender "${tender.title}" imported to Leads.`);
        setImportedTenderIds(prev => [...prev, tender.id]);
        fetchLeads();
      } else {
        showNotification("Failed to import tender", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Failed to import tender", "error");
    } finally {
      setImportingTenderId(null);
    }
  };

  // ==========================================================================
  // STATE: LINKEDIN DIRECTORY
  // ==========================================================================
  const externalLinkedInProfiles: ExternalLinkedInProfile[] = [];

  const [importingLinkedInId, setImportingLinkedInId] = useState<string | null>(null);
  const [importedLinkedInIds, setImportedLinkedInIds] = useState<string[]>([]);

  const handleImportLinkedIn = async (profile: any) => {
    setImportingLinkedInId(profile.id);
    try {
      const response = await createCrmLead({
        company_name: profile.company,
        contact_name: profile.name,
        contact_email: profile.email,
        contact_phone: profile.phone,
        sector: profile.sector,
        estimated_budget: 350000, // standard default
        lead_source: "LinkedIn Import"
      });
      if (response.success) {
        showNotification(`Contact "${profile.name}" imported to Leads.`);
        setImportedLinkedInIds(prev => [...prev, profile.id]);
        fetchLeads();
      } else {
        showNotification("Failed to import contact", "error");
      }
    } catch (err) {
      console.error(err);
      showNotification("Failed to import contact", "error");
    } finally {
      setImportingLinkedInId(null);
    }
  };

  // Sort leads by highest AI score (descending) and filter out locally dismissed leads
  const processedLeads = [...leads]
    .sort((a, b) => b.ai_score - a.ai_score)
    .filter(l => !dismissedLeadIds.includes(l.id));

  // ==========================================================================
  // RENDER: LEADS INBOX (Intelligence Grid)
  // ==========================================================================
  const renderInbox = () => {
    if (isLoading && leads.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center h-96">
          <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin mb-4" />
          <span className="font-mono text-xs text-slate-light tracking-widest uppercase">Initializing Telemetry Feed...</span>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500">
        <header className="flex justify-between items-end border-b border-[#1c1c1c] pb-6 mb-8 shrink-0">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-white mb-1 flex items-center">
              <Inbox className="w-6 h-6 mr-3 text-[#D4AF37]" />
              Leads Inbox
            </h1>
            <p className="text-xs text-slate-light font-mono tracking-widest uppercase">AI-Scored Commercial Signals</p>
          </div>
          <div className="flex space-x-3 items-center">
             <button
               onClick={() => setIsManualModalOpen(true)}
               className="px-4 py-2 bg-[#D4AF37] text-[#050505] font-mono text-xs font-bold hover:bg-[#D4AF37]/90 transition-colors flex items-center justify-center border border-transparent active:scale-95"
             >
               <Plus className="w-4 h-4 mr-1.5" /> LOG MANUAL LEAD
             </button>
             <div className="px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] flex items-center">
               <div className="w-2 h-2 rounded-full bg-[#D4AF37] animate-pulse mr-2"></div>
               <span className="font-mono text-xs text-slate-light uppercase">ML Engine Active</span>
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto pb-12 pr-4">
          <div className="mb-6 flex justify-between items-center">
            <h2 className="font-mono text-xs text-slate-light tracking-widest uppercase">Incoming Signals Matrix</h2>
            <span className="font-mono text-[10px] px-2 py-1 bg-[#1c1c1c] text-white">
              <span className="font-bold text-[#D4AF37] font-mono">{processedLeads.length}</span> UNPROCESSED SIGNALS
            </span>
          </div>

          <div className="space-y-4">
            {processedLeads.map((lead) => (
              <div key={lead.id} className="bg-[#0a0a0a] border border-[#1c1c1c] p-5 hover:border-[#D4AF37]/50 transition-all duration-300 group">
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2 flex-wrap gap-y-1">
                      <h3 className="font-sans text-lg font-semibold text-white group-hover:text-[#D4AF37] transition-colors">{lead.company_name}</h3>
                      <span className="font-mono text-[10px] px-2 py-0.5 bg-[#050505] border border-[#1c1c1c] text-slate-light rounded-sm uppercase">
                        {lead.sector}
                      </span>
                      {lead.ai_score >= 80 && (
                         <span className="font-mono text-[10px] px-2 py-0.5 bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] rounded-sm flex items-center">
                           <Zap className="w-3 h-3 mr-1" /> HOT PROSPECT
                         </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-6 text-xs font-mono text-slate-light flex-wrap gap-y-1">
                      <div className="flex items-center"><Clock className="w-3.5 h-3.5 mr-1.5" /> Source: {lead.lead_source}</div>
                      <div className="flex items-center"><Building2 className="w-3.5 h-3.5 mr-1.5" /> Est. Budget: <span className="text-white ml-1 font-mono">${lead.estimated_budget.toLocaleString()}</span></div>
                      {lead.contact_name && <div className="flex items-center"><UserCheck className="w-3.5 h-3.5 mr-1.5" /> Contact: {lead.contact_name}</div>}
                    </div>
                  </div>

                  <div className="flex-1 bg-[#050505] border border-[#1c1c1c] p-3 border-l-2 border-l-[#D4AF37]/50 w-full xl:w-auto">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-mono text-[10px] text-slate-light uppercase tracking-widest flex items-center">
                        <TrendingUp className="w-3 h-3 mr-1" /> Propensity Score
                      </h4>
                      <span className={`font-mono text-xl px-2 py-0.5 border ${getScoreColor(lead.ai_score)}`}>
                        {lead.ai_score}
                      </span>
                    </div>
                    <p className="text-xs text-slate-light font-sans leading-relaxed">
                      <span className="text-[#D4AF37] mr-1">AI Rationale:</span> 
                      {lead.ai_rationale}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row xl:flex-col space-y-2 sm:space-y-0 xl:space-y-2 sm:space-x-2 xl:space-x-0 w-full xl:w-auto xl:ml-4">
                    <button 
                      onClick={() => openQualifyWizard(lead)}
                      disabled={qualifyingId === lead.id}
                      className="px-6 py-3 bg-[#D4AF37] text-[#050505] font-mono text-xs font-bold hover:bg-[#D4AF37]/90 transition-colors flex items-center justify-center disabled:opacity-50 flex-1 sm:flex-none"
                    >
                      {qualifyingId === lead.id ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> QUALIFYING...</>
                      ) : (
                        <><ShieldCheck className="w-4 h-4 mr-2" /> QUALIFY & CONVERT</>
                      )}
                    </button>
                    <button 
                      onClick={() => handleDismiss(lead.id)}
                      className="px-6 py-2 border border-[#1c1c1c] text-slate-light hover:text-white hover:border-slate-light font-mono text-xs transition-colors flex items-center justify-center flex-1 sm:flex-none"
                    >
                      DISMISS
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {processedLeads.length === 0 && !isLoading && (
              <div className="bg-[#0a0a0a] border border-dashed border-[#1c1c1c] p-12 text-center">
                <Target className="w-8 h-8 text-slate-light mx-auto mb-4 opacity-50" />
                <h3 className="font-mono text-sm text-white mb-2 uppercase tracking-widest">No Active Leads</h3>
                <p className="font-sans text-sm text-slate-light">The intelligence grid is waiting for new commercial signals.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ==========================================================================
  // RENDER: WEB FORMS BUILDER
  // ==========================================================================
  const renderWebForms = () => {
    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500 overflow-y-auto">
        <header className="flex justify-between items-end border-b border-[#1c1c1c] pb-6 mb-8 shrink-0">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-white mb-1 flex items-center">
              <FormInput className="w-6 h-6 mr-3 text-[#D4AF37]" />
              Web Forms
            </h1>
            <p className="text-xs text-slate-light font-mono tracking-widest uppercase">LeadBooster Form Generator</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pb-12">
          {/* Controls Panel */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] p-6 space-y-6">
              <h3 className="font-mono text-xs text-white uppercase tracking-widest border-b border-[#1c1c1c] pb-2">Form Settings</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-slate-light uppercase mb-1.5">Form Title</label>
                  <input 
                    type="text" 
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full bg-[#050505] border border-[#1c1c1c] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37] font-sans"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-light uppercase mb-1.5">Action Button Text</label>
                  <input 
                    type="text" 
                    value={formButtonText}
                    onChange={(e) => setFormButtonText(e.target.value)}
                    className="w-full bg-[#050505] border border-[#1c1c1c] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37] font-sans"
                  />
                </div>
              </div>

              <h3 className="font-mono text-xs text-white uppercase tracking-widest border-b border-[#1c1c1c] pb-2 pt-2">Field Matrix</h3>
              <div className="space-y-3">
                {formFields.map((field) => (
                  <div key={field.id} className="flex flex-col p-3 bg-[#050505] border border-[#1c1c1c] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <input 
                          type="checkbox" 
                          checked={field.enabled}
                          onChange={() => toggleFieldEnabled(field.id)}
                          className="w-4 h-4 bg-[#050505] border border-[#1c1c1c] text-[#D4AF37] rounded focus:ring-0 cursor-pointer"
                        />
                        <span className="font-sans text-sm text-white font-medium">{field.id.toUpperCase()}</span>
                      </div>
                      {field.enabled && (
                        <div className="flex items-center space-x-1">
                          <span className="text-[10px] font-mono text-slate-light uppercase font-mono">Required:</span>
                          <button 
                            onClick={() => toggleFieldRequired(field.id)}
                            className={`px-2 py-0.5 font-mono text-[9px] border transition-colors ${field.required ? 'bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30' : 'bg-transparent text-slate-light border-[#1c1c1c]'}`}
                          >
                            {field.required ? 'YES' : 'NO'}
                          </button>
                        </div>
                      )}
                    </div>
                    {field.enabled && (
                      <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-[#1c1c1c]/50">
                        <div>
                          <label className="text-[9px] font-mono text-slate-light uppercase">Label</label>
                          <input 
                            type="text" 
                            value={field.label}
                            onChange={(e) => handleUpdateFieldLabel(field.id, e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-[#1c1c1c] px-2 py-1 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-mono text-slate-light uppercase">Placeholder</label>
                          <input 
                            type="text" 
                            value={field.placeholder}
                            onChange={(e) => handleUpdateFieldPlaceholder(field.id, e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-[#1c1c1c] px-2 py-1 text-xs text-white focus:outline-none focus:border-[#D4AF37]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Preview & Integration Code Panel */}
          <div className="lg:col-span-7 space-y-6">
            {/* Live Preview */}
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-[#1c1c1c] pb-3">
                <h3 className="font-mono text-xs text-white uppercase tracking-widest">Live Form Preview</h3>
                <span className="font-mono text-[10px] px-2 py-0.5 bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 uppercase">Interactive</span>
              </div>
              
              <div className="bg-[#050505] border border-[#1c1c1c] p-8 max-w-md mx-auto space-y-6 shadow-xl">
                <div className="border-b border-[#1c1c1c] pb-4">
                  <h4 className="font-sans text-lg font-bold text-white tracking-tight">{formTitle}</h4>
                  <p className="text-xs text-slate-light mt-1">SNC Inbound Commercial Integration Portal</p>
                </div>
                
                <form onSubmit={handleWebFormSubmit} className="space-y-4">
                  {formFields.filter(f => f.enabled).map((field) => (
                    <div key={field.id} className="space-y-1">
                      <label className="block text-xs font-sans font-medium text-slate-light">
                        {field.label} {field.required && <span className="text-[#D4AF37]">*</span>}
                      </label>
                      {field.type === 'textarea' ? (
                        <textarea
                          placeholder={field.placeholder}
                          rows={3}
                          value={formInputData[field.id] || ''}
                          onChange={(e) => handleFormInputChange(field.id, e.target.value)}
                          className="w-full bg-[#0a0a0a] border border-[#1c1c1c] p-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] font-sans"
                        />
                      ) : field.type === 'select' ? (
                        <select
                          value={formInputData[field.id] || ''}
                          onChange={(e) => handleFormInputChange(field.id, e.target.value)}
                          className="w-full bg-[#0a0a0a] border border-[#1c1c1c] p-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] font-sans"
                        >
                          <option value="">{field.placeholder}</option>
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          placeholder={field.placeholder}
                          value={formInputData[field.id] || ''}
                          onChange={(e) => handleFormInputChange(field.id, e.target.value)}
                          className="w-full bg-[#0a0a0a] border border-[#1c1c1c] p-2.5 text-sm text-white focus:outline-none focus:border-[#D4AF37] font-sans"
                        />
                      )}
                    </div>
                  ))}
                  
                  <button 
                    type="submit" 
                    disabled={isSubmittingWebForm}
                    className="w-full py-3 bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-[#050505] font-mono text-xs font-bold transition-colors tracking-widest uppercase mt-2 flex items-center justify-center disabled:opacity-50"
                  >
                    {isSubmittingWebForm ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> SUBMITTING...</>
                    ) : (
                      formButtonText
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Integration Snippet */}
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-[#1c1c1c] pb-3">
                <h3 className="font-mono text-xs text-white uppercase tracking-widest">Deploy Embed Code</h3>
                <div className="flex space-x-2 bg-[#050505] p-0.5 border border-[#1c1c1c]">
                  <button 
                    onClick={() => setEmbedCodeTab('iframe')}
                    className={`px-3 py-1 font-mono text-[10px] transition-colors ${embedCodeTab === 'iframe' ? 'bg-[#D4AF37] text-[#050505] font-bold' : 'text-slate-light hover:text-white'}`}
                  >
                    IFRAME
                  </button>
                  <button 
                    onClick={() => setEmbedCodeTab('script')}
                    className={`px-3 py-1 font-mono text-[10px] transition-colors ${embedCodeTab === 'script' ? 'bg-[#D4AF37] text-[#050505] font-bold' : 'text-slate-light hover:text-white'}`}
                  >
                    SCRIPT
                  </button>
                </div>
              </div>

              <div className="relative">
                <pre className="w-full bg-[#050505] border border-[#1c1c1c] p-4 text-xs font-mono text-slate-light overflow-x-auto whitespace-pre-wrap select-all">
                  {embedCodeTab === 'iframe' ? generatedIframeCode : generatedScriptCode}
                </pre>
                <button 
                  onClick={copyFormCode}
                  className="absolute top-3 right-3 bg-[#0a0a0a] border border-[#1c1c1c] p-2 hover:border-[#D4AF37] text-slate-light hover:text-white transition-colors"
                >
                  {copiedFormCode ? <Check className="w-4 h-4 text-[#D4AF37]" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] font-mono text-slate-light flex items-center">
                <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-[#D4AF37]" /> Paste this telemetry anchor into your construction landing page. Inbound responses bypass checks and load directly to Leads Inbox.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ==========================================================================
  // RENDER: SIGNAL BOT
  // ==========================================================================
  const renderSignalBot = () => {
    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500 overflow-y-auto">
        <header className="flex justify-between items-end border-b border-[#1c1c1c] pb-6 mb-8 shrink-0">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-white mb-1 flex items-center">
              <Bot className="w-6 h-6 mr-3 text-[#3B82F6]" />
              Signal Bot Configuration
            </h1>
            <p className="text-xs text-slate-light font-mono tracking-widest uppercase">Autonomous AI Lead Agent</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pb-12">
          {/* Config Parameters (Left Panel) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] p-6 space-y-6">
              <h3 className="font-mono text-xs text-[#3B82F6] uppercase tracking-widest border-b border-[#1c1c1c] pb-2">Bot Telemetry Parameters</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-slate-light uppercase mb-1.5">Greeting Message</label>
                  <textarea 
                    value={botGreeting}
                    onChange={(e) => setBotGreeting(e.target.value)}
                    rows={3}
                    className="w-full bg-[#050505] border border-[#1c1c1c] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3B82F6] font-sans"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-light uppercase mb-1.5">Business Hours</label>
                  <input 
                    type="text" 
                    value={botHours}
                    onChange={(e) => setBotHours(e.target.value)}
                    className="w-full bg-[#050505] border border-[#1c1c1c] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3B82F6] font-mono"
                  />
                </div>
              </div>

              <div className="border-t border-[#1c1c1c] pt-4 space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="font-mono text-xs text-white uppercase tracking-widest">Qualifying Questions</h4>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 bg-[#1c1c1c] text-[#3B82F6]">{botQuestions.length} Steps</span>
                </div>
                
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {botQuestions.map((q, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-[#050505] border border-[#1c1c1c] space-x-2">
                      <div className="flex items-start space-x-2">
                        <span className="font-mono text-[10px] text-[#3B82F6] mt-0.5">{idx + 1}.</span>
                        <span className="font-sans text-xs text-slate-light leading-relaxed">{q}</span>
                      </div>
                      <button 
                        onClick={() => handleRemoveQuestion(idx)}
                        className="text-slate-light hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex space-x-2">
                  <input 
                    type="text"
                    placeholder="Add qualifying question..."
                    value={newQuestionInput}
                    onChange={(e) => setNewQuestionInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddQuestion()}
                    className="flex-1 bg-[#050505] border border-[#1c1c1c] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#3B82F6]"
                  />
                  <button 
                    onClick={handleAddQuestion}
                    className="p-2 bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white font-mono transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Site Landing Page & Live Chat Bubble (Right Panel) */}
          <div className="lg:col-span-7">
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-[#1c1c1c] pb-3">
                <h3 className="font-mono text-xs text-white uppercase tracking-widest">SNC Client Portal Preview</h3>
                <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-light">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  <span>PREVIEW ENGINE READY</span>
                </div>
              </div>

              {/* Landing Page Preview Box */}
              <div className="relative w-full h-[480px] bg-[#050505] border border-[#1c1c1c] overflow-hidden flex flex-col justify-between p-8 font-mono">
                {/* Tech Grid Pattern */}
                <div 
                  className="absolute inset-0 pointer-events-none opacity-[0.03] z-0"
                  style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
                />

                {/* Mock Site Header */}
                <div className="relative z-10 flex justify-between items-center border-b border-[#1c1c1c] pb-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-[#D4AF37]"></div>
                    <span className="font-bold tracking-widest text-white text-xs">SNC / SHIELD</span>
                  </div>
                  <div className="flex space-x-4 text-[9px] text-slate-light">
                    <span>CAPABILITIES</span>
                    <span>METRIC TELEMETRY</span>
                    <span>CLIENT PORTAL</span>
                  </div>
                </div>

                {/* Mock Site Body */}
                <div className="relative z-10 my-auto text-left max-w-md">
                  <h1 className="font-display text-2xl text-white font-bold leading-tight mb-2 tracking-tight uppercase">
                    Heavy Infrastructure <span className="text-[#D4AF37]">&</span> Resource Mining Integration
                  </h1>
                  <p className="text-xs text-slate-light leading-relaxed font-sans">
                    Six Nine Construction deploys autonomous engineering networks, bulk earthmoving fleets, and structural steel processing to Sub-Saharan resource sectors.
                  </p>
                  <div className="mt-4 flex space-x-3">
                    <button className="px-4 py-2 border border-[#D4AF37] text-[#D4AF37] text-[10px] font-bold tracking-wider hover:bg-[#D4AF37]/10 transition-colors uppercase">
                      Systems Manifest
                    </button>
                    <button className="px-4 py-2 border border-[#1c1c1c] text-slate-light text-[10px] tracking-wider hover:text-white transition-colors uppercase">
                      Audit Trail
                    </button>
                  </div>
                </div>

                {/* Mock Site Footer */}
                <div className="relative z-10 flex justify-between items-center border-t border-[#1c1c1c] pt-4 text-[8px] text-slate-light">
                  <span>TELEMETRY FEED OK</span>
                  <span>EST. 1969 // SNC ZIMBABWE</span>
                </div>

                {/* Floating Chat Bubble or Expanded Chat Panel */}
                {!isChatOpen ? (
                  <button 
                    onClick={startChatbotSimulator}
                    className="absolute bottom-6 right-6 w-12 h-12 bg-[#3B82F6] rounded-full flex items-center justify-center text-white shadow-[0_0_15px_rgba(59,130,246,0.5)] hover:scale-105 transition-transform z-20 group"
                  >
                    <Bot className="w-6 h-6" />
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3B82F6] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#3B82F6] border-2 border-[#050505]"></span>
                    </span>
                  </button>
                ) : (
                  /* Chat Panel Drawer */
                  <div className="absolute bottom-6 right-6 w-80 h-96 bg-[#0a0a0a] border border-[#3B82F6]/50 shadow-2xl flex flex-col z-30 font-sans">
                    {/* Chat Header */}
                    <div className="bg-[#050505] border-b border-[#3B82F6]/30 p-3 flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                        <div>
                          <p className="text-xs font-bold text-white tracking-wide">SNC Signal Bot</p>
                          <p className="text-[9px] text-[#3B82F6] font-mono">{botHours}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setIsChatOpen(false)}
                        className="text-slate-light hover:text-white p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 p-3 overflow-y-auto space-y-3 bg-[#050505] flex flex-col">
                      {chatMessages.map((msg, i) => (
                        <div 
                          key={i} 
                          className={`max-w-[85%] p-2.5 rounded-sm text-xs leading-relaxed ${
                            msg.sender === 'bot' 
                              ? 'bg-[#1c1c1c] text-white border border-[#2c2c2c] self-start' 
                              : 'bg-[#3B82F6]/10 text-white border border-[#3B82F6]/30 self-end'
                          }`}
                        >
                          {msg.text}
                        </div>
                      ))}
                      {isSubmittingChatLead && (
                        <div className="flex items-center space-x-2 text-[10px] text-slate-light italic font-mono self-start bg-[#1c1c1c] p-2 border border-[#2c2c2c]">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3B82F6]" />
                          <span>Scoring telemetry...</span>
                        </div>
                      )}
                    </div>

                    {/* Chat Input */}
                    <form onSubmit={handleSendChatMessage} className="p-2 bg-[#0a0a0a] border-t border-[#1c1c1c] flex space-x-2">
                      <input 
                        type="text" 
                        placeholder={chatStep >= botQuestions.length ? "Signal processed" : "Type response..."}
                        value={chatInput}
                        disabled={chatStep >= botQuestions.length}
                        onChange={(e) => setChatInput(e.target.value)}
                        className="flex-1 bg-[#050505] border border-[#1c1c1c] px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#3B82F6] disabled:opacity-50"
                      />
                      <button 
                        type="submit"
                        disabled={chatStep >= botQuestions.length}
                        className="p-1.5 bg-[#3B82F6] text-white hover:bg-[#3B82F6]/90 transition-colors disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ==========================================================================
  // RENDER: AI PROSPECTOR
  // ==========================================================================
  const renderAIProspector = () => {
    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500 overflow-y-auto">
        <header className="flex justify-between items-end border-b border-[#1c1c1c] pb-6 mb-8 shrink-0">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-white mb-1 flex items-center">
              <Search className="w-6 h-6 mr-3 text-[#3B82F6]" />
              AI Prospector
            </h1>
            <p className="text-xs text-slate-light font-mono tracking-widest uppercase">Mined Gazette Contracts & Project Opportunities</p>
          </div>
        </header>

        {/* Filters */}
        <div className="bg-[#0a0a0a] border border-[#1c1c1c] p-6 mb-6 space-y-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            {/* Text Search */}
            <div className="relative w-full lg:w-96">
              <input 
                type="text"
                placeholder="Search contracts, project title or client..."
                value={prospectsSearch}
                onChange={(e) => setProspectsSearch(e.target.value)}
                className="w-full bg-[#050505] border border-[#1c1c1c] pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-[#3B82F6] placeholder-slate-dark font-sans"
              />
              <Search className="w-4 h-4 text-slate-light absolute left-3 top-3" />
            </div>

            {/* Sector Filter */}
            <div className="flex items-center space-x-2 w-full lg:w-auto">
              <span className="font-mono text-xs text-slate-light uppercase mr-2 flex items-center shrink-0">
                <Filter className="w-3.5 h-3.5 mr-1" /> Sector Filter:
              </span>
              <div className="flex bg-[#050505] p-0.5 border border-[#1c1c1c] overflow-x-auto w-full lg:w-auto">
                {['All', 'Mining', 'Roads', 'Civil'].map((sector) => (
                  <button
                    key={sector}
                    onClick={() => setProspectsSectorFilter(sector)}
                    className={`px-3 py-1 font-mono text-[10px] tracking-wider transition-colors uppercase shrink-0 ${prospectsSectorFilter === sector ? 'bg-[#D4AF37] text-[#050505] font-bold' : 'text-slate-light hover:text-white'}`}
                  >
                    {sector}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Budget Range Sliders */}
          <div className="border-t border-[#1c1c1c]/50 pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-light uppercase">Min Budget</span>
                <span className="text-[#D4AF37] font-mono tabular-nums">${minBudget.toLocaleString()}</span>
              </div>
              <input 
                type="range"
                min="0"
                max="50000000"
                step="1000000"
                value={minBudget}
                onChange={(e) => setMinBudget(Number(e.target.value))}
                className="w-full accent-[#D4AF37] bg-[#1c1c1c] h-1 appearance-none cursor-pointer"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-light uppercase">Max Budget</span>
                <span className="text-[#D4AF37] font-mono tabular-nums">${maxBudget.toLocaleString()}</span>
              </div>
              <input 
                type="range"
                min="0"
                max="50000000"
                step="1000000"
                value={maxBudget}
                onChange={(e) => setMaxBudget(Number(e.target.value))}
                className="w-full accent-[#D4AF37] bg-[#1c1c1c] h-1 appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Grid of Prospects */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
          {filteredProspects.map((prospect) => {
            const isImported = importedProspectIds.includes(prospect.id);
            const isImporting = importingProspectId === prospect.id;
            return (
              <div 
                key={prospect.id} 
                className={`bg-[#0a0a0a] border p-6 flex flex-col justify-between transition-all duration-300 ${isImported ? 'border-green-500/30' : 'border-[#1c1c1c] hover:border-[#3B82F6]/50'}`}
              >
                <div>
                  <div className="flex justify-between items-start mb-3 gap-2">
                    <div>
                      <span className="font-mono text-[9px] px-2 py-0.5 bg-[#050505] border border-[#1c1c1c] text-[#3B82F6] tracking-wider uppercase rounded-sm mr-2">{prospect.sector}</span>
                      <span className="font-mono text-[9px] px-2 py-0.5 bg-[#1c1c1c] text-slate-light tracking-wider uppercase rounded-sm">{prospect.risk.includes('Low') ? 'LOW RISK' : prospect.risk.includes('Medium') ? 'MED RISK' : 'HIGH RISK'}</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] font-mono text-slate-light">AI PROPENSITY</span>
                      <span className="font-mono text-lg font-bold text-[#D4AF37]">{prospect.score}</span>
                    </div>
                  </div>

                  <h3 className="font-sans font-bold text-lg text-white mb-2 leading-snug">{prospect.name}</h3>
                  <div className="flex items-center space-x-2 text-xs text-[#3B82F6] font-mono mb-4">
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{prospect.client}</span>
                  </div>

                  <div className="bg-[#050505] border border-[#1c1c1c] p-3 space-y-2 mb-6">
                    <div className="flex justify-between text-[11px] font-mono border-b border-[#1c1c1c] pb-1.5">
                      <span className="text-slate-light uppercase">ESTIMATED BUDGET</span>
                      <span className="text-white font-mono">${prospect.budget.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[11px] font-mono border-b border-[#1c1c1c] pb-1.5">
                      <span className="text-slate-light uppercase">CAPABILITY MATCH</span>
                      <span className="text-white text-right">{prospect.telemetry}</span>
                    </div>
                    <div className="flex justify-between text-[11px] font-mono">
                      <span className="text-slate-light uppercase">CREDIT MATRIX</span>
                      <span className="text-white">{prospect.risk}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-light font-sans italic leading-relaxed mb-6 border-l border-[#D4AF37]/50 pl-3">
                    &quot;{prospect.rationale}&quot;
                  </p>
                </div>

                <button
                  onClick={() => handleImportProspect(prospect)}
                  disabled={isImported || isImporting}
                  className={`w-full py-3 font-mono text-xs font-bold uppercase transition-colors flex items-center justify-center ${
                    isImported 
                      ? 'bg-green-500/10 text-green-500 border border-green-500/20' 
                      : 'bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-[#050505]'
                  }`}
                >
                  {isImporting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> IMPORTING TELEMETRY...</>
                  ) : isImported ? (
                    <><UserCheck className="w-4 h-4 mr-2" /> IMPORTED AS LEAD</>
                  ) : (
                    <><Database className="w-4 h-4 mr-2" /> IMPORT AS LEAD</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ==========================================================================
  // RENDER: TENDER SCRAPING Feed
  // ==========================================================================
  const renderTenderScraping = () => {
    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500 overflow-y-auto">
        <header className="flex justify-between items-end border-b border-[#1c1c1c] pb-6 mb-8 shrink-0">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-white mb-1 flex items-center">
              <RefreshCw className="w-6 h-6 mr-3 text-[#3B82F6]" />
              Automated Tender Scraping
            </h1>
            <p className="text-xs text-slate-light font-mono tracking-widest uppercase">Live feeds from PRAZ & Mining Procurement Portals</p>
          </div>
          <button
            type="button"
            onClick={loadTenderSignals}
            disabled={tenderSignalsLoading}
            className="flex items-center gap-2 border border-[#1c1c1c] bg-[#050505] px-3 py-2 text-xs font-mono uppercase tracking-wider text-white transition-colors hover:border-[#3B82F6]/40 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${tenderSignalsLoading ? 'animate-spin' : ''}`} />
            Refresh Feed
          </button>
        </header>

        {/* Filters */}
        <div className="bg-[#0a0a0a] border border-[#1c1c1c] p-6 mb-6 space-y-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            {/* Text Search */}
            <div className="relative w-full lg:w-96">
              <input 
                type="text"
                placeholder="Search tenders, ref, title or source..."
                value={tendersSearch}
                onChange={(e) => setTendersSearch(e.target.value)}
                className="w-full bg-[#050505] border border-[#1c1c1c] pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-[#3B82F6] placeholder-slate-dark font-sans"
              />
              <Search className="w-4 h-4 text-slate-light absolute left-3 top-3" />
            </div>

            {/* Sector Filter */}
            <div className="flex items-center space-x-2 w-full lg:w-auto">
              <span className="font-mono text-xs text-slate-light uppercase mr-2 flex items-center shrink-0">
                <Filter className="w-3.5 h-3.5 mr-1" /> Sector Filter:
              </span>
              <div className="flex bg-[#050505] p-0.5 border border-[#1c1c1c] overflow-x-auto w-full md:w-auto">
                {['All', 'Mining', 'Roads', 'Civil', 'Commercial'].map((sector) => (
                  <button
                    key={sector}
                    onClick={() => setTendersSectorFilter(sector)}
                    className={`px-3 py-1 font-mono text-[10px] tracking-wider transition-colors uppercase shrink-0 ${tendersSectorFilter === sector ? 'bg-[#D4AF37] text-[#050505] font-bold' : 'text-slate-light hover:text-white'}`}
                  >
                    {sector}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Budget Range Sliders */}
          <div className="border-t border-[#1c1c1c]/50 pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-light uppercase">Min Budget</span>
                <span className="text-[#D4AF37] font-mono tabular-nums">${tendersMinBudget.toLocaleString()}</span>
              </div>
              <input 
                type="range"
                min="0"
                max="10000000"
                step="500000"
                value={tendersMinBudget}
                onChange={(e) => setTendersMinBudget(Number(e.target.value))}
                className="w-full accent-[#D4AF37] bg-[#1c1c1c] h-1 appearance-none cursor-pointer"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-slate-light uppercase">Max Budget</span>
                <span className="text-[#D4AF37] font-mono tabular-nums">${tendersMaxBudget.toLocaleString()}</span>
              </div>
              <input 
                type="range"
                min="0"
                max="10000000"
                step="500000"
                value={tendersMaxBudget}
                onChange={(e) => setTendersMaxBudget(Number(e.target.value))}
                className="w-full accent-[#D4AF37] bg-[#1c1c1c] h-1 appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>

        {tenderSignalsError ? (
          <div className="mb-6 border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-200">
            {tenderSignalsError}
          </div>
        ) : null}

        {lastTenderSignalsSync ? (
          <div className="mb-6 text-[11px] font-mono uppercase tracking-widest text-slate-light">
            Last sync: {new Date(lastTenderSignalsSync).toLocaleString()}
          </div>
        ) : null}

        {tenderSignalsLoading ? (
          <div className="flex items-center gap-3 border border-[#1c1c1c] bg-[#0a0a0a] px-4 py-5 text-sm text-slate-light">
            <Loader2 className="w-4 h-4 animate-spin text-[#3B82F6]" />
            Loading tender signals from the CRM service...
          </div>
        ) : null}

        {/* Feed List */}
        <div className="space-y-4 pb-12">
          {!tenderSignalsLoading && filteredTenders.length === 0 ? (
            <div className="border border-dashed border-[#1c1c1c] bg-[#050505] px-5 py-8 text-sm text-slate-light">
              No tender signals were returned by the scraper yet.
            </div>
          ) : null}
          {filteredTenders.map((tender) => {
            const isImported = importedTenderIds.includes(tender.id);
            const isImporting = importingTenderId === tender.id;
            return (
              <div 
                key={tender.id} 
                className={`bg-[#0a0a0a] border p-5 flex flex-col justify-between gap-6 transition-all duration-300 ${isImported ? 'border-green-500/20' : 'border-[#1c1c1c] hover:border-[#3B82F6]/30'}`}
              >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="font-mono text-[9px] px-1.5 py-0.5 bg-[#050505] border border-[#1c1c1c] text-[#3B82F6] tracking-wider uppercase">{tender.source}</span>
                      <span className="font-mono text-[9px] px-1.5 py-0.5 bg-[#1c1c1c] text-slate-light tracking-wider uppercase">{tender.sector}</span>
                      <span className="font-mono text-[8px] text-slate-light">ID: {tender.ref}</span>
                      <span className="font-mono text-[8px] text-slate-light">•</span>
                      <span className="font-mono text-[8px] text-slate-light flex items-center">
                        <Clock className="w-2.5 h-2.5 mr-1" /> Mined {tender.scrapedAt}
                      </span>
                    </div>
                    <h3 className="font-sans font-semibold text-base text-white">{tender.title}</h3>
                    <div className="flex items-center space-x-4 text-xs font-mono text-slate-light">
                      <div>Est. Budget: <span className="text-white font-mono">${tender.budget.toLocaleString()}</span></div>
                      <div>•</div>
                      <div>Propensity: <span className="text-[#D4AF37] font-mono">{tender.score}%</span></div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 shrink-0 w-full md:w-auto justify-between md:justify-end">
                    <div className="text-right pr-4 border-r border-[#1c1c1c] hidden md:block">
                      <span className="block text-[8px] font-mono text-slate-light uppercase">TELEMETRY SCORE</span>
                      <span className="text-lg font-bold font-mono text-white">{tender.score}</span>
                    </div>
                    
                    <button
                      onClick={() => handleImportTender(tender)}
                      disabled={isImported || isImporting}
                      className={`px-6 py-2.5 font-mono text-xs font-bold uppercase transition-all duration-300 w-full md:w-auto ${
                        isImported 
                          ? 'bg-green-500/10 text-green-500 border border-green-500/20' 
                          : 'bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-[#050505]'
                      }`}
                    >
                      {isImporting ? (
                        <span className="flex items-center justify-center"><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> IMPORTING...</span>
                      ) : isImported ? (
                        <span className="flex items-center justify-center"><UserCheck className="w-3.5 h-3.5 mr-1.5" /> IMPORTED</span>
                      ) : (
                        'IMPORT LEAD'
                      )}
                    </button>
                  </div>
                </div>

                {/* Compliance Flags */}
                <div className="pt-4 border-t border-[#1c1c1c]/50">
                  <span className="block text-[9px] font-mono text-slate-light uppercase tracking-wider mb-2">SNC Capability & Compliance Matrix</span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {tender.compliance.map((item, idx) => (
                      <div key={idx} className="bg-[#050505] border border-[#1c1c1c] p-3 flex flex-col justify-between">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="font-mono text-[9px] text-white uppercase tracking-wider truncate">{item.label}</span>
                          <span className={`font-mono text-[8px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider font-bold ${
                            item.status === 'Compliant' 
                              ? 'bg-green-500/10 text-green-500 border border-green-500/20' 
                              : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                          }`}>
                            {item.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-light font-sans leading-relaxed">
                          {item.desc}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ==========================================================================
  // RENDER: LINKEDIN DIRECTORY
  // ==========================================================================
  const renderLinkedIn = () => {
    return (
      <div className="flex-1 flex flex-col h-full animate-in fade-in duration-500 overflow-y-auto">
        <header className="flex justify-between items-end border-b border-[#1c1c1c] pb-6 mb-8 shrink-0">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-white mb-1 flex items-center">
              <Linkedin className="w-6 h-6 mr-3 text-[#3B82F6]" />
              LinkedIn Inbound Contacts
            </h1>
            <p className="text-xs text-slate-light font-mono tracking-widest uppercase">Target Contacts Mined via LinkedIn Integration</p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
          {externalLinkedInProfiles.map((profile) => {
            const isImported = importedLinkedInIds.includes(profile.id);
            const isImporting = importingLinkedInId === profile.id;
            return (
              <div 
                key={profile.id} 
                className={`bg-[#0a0a0a] border p-6 flex flex-col justify-between transition-all duration-300 ${isImported ? 'border-green-500/20' : 'border-[#1c1c1c] hover:border-[#3B82F6]/30'}`}
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center space-x-3">
                      {/* Avatar Mock */}
                      <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${profile.avatarColor} flex items-center justify-center text-white font-bold text-sm border border-[#1c1c1c] shrink-0`}>
                        {profile.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <h3 className="font-sans font-bold text-white text-base leading-tight">{profile.name}</h3>
                        <p className="text-xs text-[#3B82F6] font-medium mt-0.5">{profile.title}</p>
                      </div>
                    </div>
                    <span className="font-mono text-[9px] px-2 py-0.5 bg-[#1c1c1c] text-slate-light uppercase rounded-sm border border-[#2c2c2c] shrink-0">
                      {profile.connection}
                    </span>
                  </div>

                  <div className="bg-[#050505] border border-[#1c1c1c] p-3 space-y-2 mb-6 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-light uppercase">COMPANY</span>
                      <span className="text-white text-right truncate max-w-[180px]">{profile.company}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-light uppercase">EMAIL</span>
                      <span className="text-white text-right truncate max-w-[180px]">{profile.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-light uppercase">PHONE</span>
                      <span className="text-white text-right font-mono">{profile.phone}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-light uppercase">REGION</span>
                      <span className="text-white">{profile.location}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleImportLinkedIn(profile)}
                  disabled={isImported || isImporting}
                  className={`w-full py-2.5 font-mono text-xs font-bold uppercase transition-colors flex items-center justify-center ${
                    isImported 
                      ? 'bg-green-500/10 text-green-500 border border-green-500/20' 
                      : 'bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-[#050505]'
                  }`}
                >
                  {isImporting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> IMPORTING TELEMETRY...</>
                  ) : isImported ? (
                    <><UserCheck className="w-4 h-4 mr-2" /> LEAD IMPORTED</>
                  ) : (
                    <><Linkedin className="w-4 h-4 mr-2" /> IMPORT CONTACT AS LEAD</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#050505] flex font-sans selection:bg-[#D4AF37] selection:text-[#050505] w-full relative">
      
      {/* Texture Layer */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.02] mix-blend-screen z-0"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }}
      />

      {/* Floating Notification Toast */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0a0a0a] border border-[#D4AF37] p-4 flex items-center justify-between space-x-6 shadow-2xl animate-in slide-in-from-bottom duration-300 font-mono text-xs max-w-sm">
          <div className="flex items-center space-x-2.5">
            <div className={`w-1.5 h-1.5 rounded-full ${notification.type === 'error' ? 'bg-red-500' : 'bg-[#D4AF37]'}`}></div>
            <span className="text-white">{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-slate-light hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      
      {/* Secondary Left Sidebar */}
      <aside className="w-64 bg-[#0a0a0a] border-r border-[#1c1c1c] flex-shrink-0 flex flex-col z-10 py-6">
        
        {/* Module Title */}
        <div className="px-6 mb-8 flex items-center text-white font-sans text-lg font-semibold tracking-tight">
          <Link href="/dashboard/crm" className="text-slate-light hover:text-white mr-2">CRM</Link>
          <span className="text-slate-dark mr-2">/</span>
          <span>Leads</span>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-8">
          
          {/* Section 1: Inbox */}
          <div className="px-4 space-y-1">
            <button 
              onClick={() => setActiveTab('inbox')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'inbox' ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 font-bold' : 'text-slate-light hover:bg-[#111111] hover:text-white'}`}
            >
              <Inbox className="w-4 h-4" />
              <span>Leads Inbox</span>
            </button>
          </div>

          {/* Section 2: LEAD ENGINE */}
          <div className="px-4">
            <h3 className="text-[10px] font-mono tracking-widest text-slate-light opacity-50 uppercase mb-2 px-3">Lead Engine</h3>
            <div className="space-y-1">
              <button 
                onClick={() => setActiveTab('web_forms')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'web_forms' ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 font-bold' : 'text-slate-light hover:bg-[#111111] hover:text-white'}`}
              >
                <FormInput className="w-4 h-4" />
                <span>Web Forms</span>
              </button>
              
              <button 
                onClick={() => setActiveTab('signal_bot')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'signal_bot' ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20 font-bold' : 'text-slate-light hover:bg-[#111111] hover:text-white'}`}
              >
                <Bot className="w-4 h-4" />
                <span>Signal Bot</span>
              </button>
              
              <button 
                onClick={() => setActiveTab('prospector')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'prospector' ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 font-bold' : 'text-slate-light hover:bg-[#111111] hover:text-white'}`}
              >
                <Search className="w-4 h-4" />
                <span>AI Prospector</span>
              </button>
            </div>
          </div>

          {/* Section 3: AUTOMATION */}
          <div className="px-4">
            <h3 className="text-[10px] font-mono tracking-widest text-slate-light opacity-50 uppercase mb-2 px-3">Scraping & Feeds</h3>
            <div className="space-y-1">
              <button 
                onClick={() => setActiveTab('tender_scraping')}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'tender_scraping' ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 font-bold' : 'text-slate-light hover:bg-[#111111] hover:text-white'}`}
              >
                <RefreshCw className="w-4 h-4" />
                <span>Tender Scraping</span>
              </button>
            </div>
          </div>

          {/* Section 4: INTEGRATIONS */}
          <div className="px-4">
            <h3 className="text-[10px] font-mono tracking-widest text-slate-light opacity-50 uppercase mb-2 px-3">Integrations</h3>
            <div className="space-y-1">
              <button 
                onClick={() => setActiveTab('linkedin')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-sm font-medium transition-colors ${activeTab === 'linkedin' ? 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 font-bold' : 'text-slate-light hover:bg-[#111111] hover:text-white'}`}
              >
                <div className="flex items-center space-x-3">
                  <Linkedin className="w-4 h-4 text-[#3B82F6]" />
                  <span>LinkedIn Directory</span>
                </div>
                <span className="bg-[#D4AF37] text-[#050505] text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider font-mono">LIVE</span>
              </button>
            </div>
          </div>

        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 bg-[#050505] overflow-hidden flex flex-col p-8 pt-6">
         {activeTab === 'inbox' && renderInbox()}
         {activeTab === 'web_forms' && renderWebForms()}
         {activeTab === 'signal_bot' && renderSignalBot()}
         {activeTab === 'prospector' && renderAIProspector()}
         {activeTab === 'tender_scraping' && renderTenderScraping()}
         {activeTab === 'linkedin' && renderLinkedIn()}
      </main>
      {/* Manual Lead Logging Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#050505] border border-[#D4AF37] max-w-lg w-full flex flex-col shadow-[0_0_50px_rgba(212,175,55,0.15)] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="border-b border-[#1c1c1c] p-5 flex justify-between items-center bg-[#0a0a0a]">
              <div>
                <h3 className="font-mono text-sm text-white font-bold uppercase tracking-widest flex items-center">
                  <Database className="w-4 h-4 mr-2 text-[#D4AF37]" /> Log Manual Lead Signal
                </h3>
                <p className="text-[10px] text-slate-light font-mono mt-1 uppercase tracking-wider">Manual telemetry injection</p>
              </div>
              <button 
                onClick={() => setIsManualModalOpen(false)}
                className="text-slate-light hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleManualLeadSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-mono text-slate-light uppercase">Company Name *</label>
                  <input
                    type="text"
                    required
                    value={manualLeadData.company_name}
                    onChange={(e) => setManualLeadData({ ...manualLeadData, company_name: e.target.value })}
                    placeholder="e.g. RioZim Ltd"
                    className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-mono text-slate-light uppercase">Contact Name *</label>
                  <input
                    type="text"
                    required
                    value={manualLeadData.contact_name}
                    onChange={(e) => setManualLeadData({ ...manualLeadData, contact_name: e.target.value })}
                    placeholder="e.g. John Doe"
                    className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-mono text-slate-light uppercase">Contact Email</label>
                  <input
                    type="email"
                    value={manualLeadData.contact_email}
                    onChange={(e) => setManualLeadData({ ...manualLeadData, contact_email: e.target.value })}
                    placeholder="name@company.com"
                    className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-mono text-slate-light uppercase">Contact Phone</label>
                  <input
                    type="text"
                    value={manualLeadData.contact_phone}
                    onChange={(e) => setManualLeadData({ ...manualLeadData, contact_phone: e.target.value })}
                    placeholder="+263 77 000 0000"
                    className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-mono text-slate-light uppercase">Sector *</label>
                  <select
                    value={manualLeadData.sector}
                    onChange={(e) => setManualLeadData({ ...manualLeadData, sector: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="Mining">Mining</option>
                    <option value="Roads">Roads</option>
                    <option value="Civil">Civil</option>
                    <option value="Commercial">Commercial</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-mono text-slate-light uppercase">Est. Budget (USD) *</label>
                  <input
                    type="number"
                    required
                    value={manualLeadData.estimated_budget}
                    onChange={(e) => setManualLeadData({ ...manualLeadData, estimated_budget: e.target.value })}
                    placeholder="e.g. 500000"
                    className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-mono text-slate-light uppercase">Lead Source *</label>
                <input
                  type="text"
                  required
                  value={manualLeadData.lead_source}
                  onChange={(e) => setManualLeadData({ ...manualLeadData, lead_source: e.target.value })}
                  placeholder="e.g. Manual, Trade Show, Referral"
                  className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>

              <div className="border-t border-[#1c1c1c] pt-4 mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 border border-[#1c1c1c] hover:border-slate-light text-slate-light hover:text-white font-mono text-xs uppercase transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingManualLead}
                  className="px-6 py-2 bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-[#050505] font-mono text-xs font-bold uppercase transition-colors flex items-center"
                >
                  {isSubmittingManualLead ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> SUBMITTING...</>
                  ) : (
                    'Log Lead'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lead Qualification Wizard Modal */}
      {isQualifyWizardOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#050505] border border-[#D4AF37] max-w-lg w-full flex flex-col shadow-[0_0_50px_rgba(212,175,55,0.15)] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="border-b border-[#1c1c1c] p-5 flex justify-between items-center bg-[#0a0a0a]">
              <div>
                <h3 className="font-mono text-sm text-white font-bold uppercase tracking-widest flex items-center">
                  <ShieldCheck className="w-4 h-4 mr-2 text-[#D4AF37]" /> Lead Qualification Wizard
                </h3>
                <p className="text-[10px] text-slate-light font-mono mt-1 uppercase tracking-wider">
                  Step {wizardStep} of 4: {
                    wizardStep === 1 ? 'Client Organization Details' :
                    wizardStep === 2 ? 'Contact Details' :
                    wizardStep === 3 ? 'Opportunity Parameters' :
                    'Initial Activity Scheduling'
                  }
                </p>
              </div>
              <button 
                onClick={() => setIsQualifyWizardOpen(false)}
                className="text-slate-light hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Progress Tracker */}
            <div className="px-6 pt-5 bg-[#080808] flex justify-center border-b border-[#111111]">
              <div className="flex items-center space-x-1 font-mono text-[10px] mb-4">
                {[
                  { num: 1, label: 'Organization' },
                  { num: 2, label: 'Contact' },
                  { num: 3, label: 'Opportunity' },
                  { num: 4, label: 'Activity' }
                ].map((s) => (
                  <div key={s.num} className="flex items-center">
                    <span className={`px-2 py-0.5 border ${wizardStep === s.num ? 'bg-[#D4AF37] text-[#050505] border-[#D4AF37]' : 'border-[#1c1c1c] text-slate-light bg-[#050505]'}`}>
                      0{s.num} {s.label}
                    </span>
                    {s.num < 4 && <span className="mx-1.5 text-[#1c1c1c]">—</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Body / Forms */}
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              
              {/* Step 1: Client Organization Details */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono text-slate-light uppercase">Company Name *</label>
                    <input
                      type="text"
                      required
                      value={wizardOrg.name}
                      onChange={(e) => setWizardOrg({ ...wizardOrg, name: e.target.value })}
                      placeholder="e.g. RioZim Ltd"
                      className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono text-slate-light uppercase">Industry / Sector *</label>
                    <select
                      value={wizardOrg.sector}
                      onChange={(e) => setWizardOrg({ ...wizardOrg, sector: e.target.value })}
                      className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="Mining">Mining</option>
                      <option value="Roads">Roads</option>
                      <option value="Civil">Civil</option>
                      <option value="Commercial">Commercial</option>
                      <option value="Government">Government</option>
                      <option value="General">General / Other</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono text-slate-light uppercase">Website</label>
                    <input
                      type="url"
                      value={wizardOrg.website}
                      onChange={(e) => setWizardOrg({ ...wizardOrg, website: e.target.value })}
                      placeholder="https://example.com"
                      className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono text-slate-light uppercase">Reg. Number</label>
                      <input
                        type="text"
                        value={wizardOrg.registration_number}
                        onChange={(e) => setWizardOrg({ ...wizardOrg, registration_number: e.target.value })}
                        placeholder="e.g. 1048/2026"
                        className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono text-slate-light uppercase">Tax ID / TIN</label>
                      <input
                        type="text"
                        value={wizardOrg.tax_id}
                        onChange={(e) => setWizardOrg({ ...wizardOrg, tax_id: e.target.value })}
                        placeholder="e.g. 200012345"
                        className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono text-slate-light uppercase">Physical Address</label>
                    <textarea
                      value={wizardOrg.address}
                      onChange={(e) => setWizardOrg({ ...wizardOrg, address: e.target.value })}
                      placeholder="Enter company address..."
                      rows={2}
                      className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Contact Details */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono text-slate-light uppercase">Contact Name *</label>
                    <input
                      type="text"
                      required
                      value={wizardContact.contact_name}
                      onChange={(e) => setWizardContact({ ...wizardContact, contact_name: e.target.value })}
                      placeholder="e.g. John Doe"
                      className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono text-slate-light uppercase">Email Address</label>
                      <input
                        type="email"
                        value={wizardContact.email}
                        onChange={(e) => setWizardContact({ ...wizardContact, email: e.target.value })}
                        placeholder="name@company.com"
                        className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono text-slate-light uppercase">Phone Number</label>
                      <input
                        type="text"
                        value={wizardContact.phone}
                        onChange={(e) => setWizardContact({ ...wizardContact, phone: e.target.value })}
                        placeholder="+263 77 000 0000"
                        className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono text-slate-light uppercase">Job Title</label>
                    <input
                      type="text"
                      value={wizardContact.job_title}
                      onChange={(e) => setWizardContact({ ...wizardContact, job_title: e.target.value })}
                      placeholder="e.g. Procurement Lead"
                      className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>
                  <div className="pt-2">
                    <label className="flex items-center space-x-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={wizardContact.whatsapp_preference}
                        onChange={(e) => setWizardContact({ ...wizardContact, whatsapp_preference: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-5 h-5 border border-[#1c1c1c] peer-checked:border-[#D4AF37] peer-checked:bg-[#D4AF37]/10 flex items-center justify-center transition-all bg-[#0a0a0a]">
                        {wizardContact.whatsapp_preference && <Check className="w-3.5 h-3.5 text-[#D4AF37]" />}
                      </div>
                      <span className="text-xs font-mono text-slate-light uppercase tracking-wider group-hover:text-white transition-colors">
                        Preferred WhatsApp Communication Channel
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Step 3: Opportunity Parameters */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-mono text-slate-light uppercase">Deal / Opportunity Name *</label>
                    <input
                      type="text"
                      required
                      value={wizardOpportunity.name}
                      onChange={(e) => setWizardOpportunity({ ...wizardOpportunity, name: e.target.value })}
                      placeholder="e.g. Ministry of Transport - Government Project"
                      className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono text-slate-light uppercase">Est. Budget (USD) *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-xs text-slate-light font-mono">$</span>
                        <input
                          type="number"
                          required
                          value={wizardOpportunity.budget}
                          onChange={(e) => setWizardOpportunity({ ...wizardOpportunity, budget: Number(e.target.value) })}
                          placeholder="e.g. 15000000"
                          className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] pl-7 pr-3 py-2 text-sm text-white focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-mono text-slate-light uppercase">Pipeline Stage *</label>
                      <select
                        value={wizardOpportunity.stage}
                        onChange={(e) => setWizardOpportunity({ ...wizardOpportunity, stage: e.target.value })}
                        className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                      >
                        <option value="Inquiry">Inquiry</option>
                        <option value="Qualification">Qualification</option>
                        <option value="Site Visit">Site Visit</option>
                        <option value="Quotation">Quotation</option>
                        <option value="Negotiation">Negotiation</option>
                        <option value="Contract">Contract</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-mono text-slate-light uppercase">Conversion Probability *</label>
                      <span className="font-mono text-xs text-[#D4AF37]">{wizardOpportunity.probability}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={wizardOpportunity.probability}
                      onChange={(e) => setWizardOpportunity({ ...wizardOpportunity, probability: Number(e.target.value) })}
                      className="w-full accent-[#D4AF37] bg-[#111111] h-1 rounded-none outline-none appearance-none"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-light">
                      <span>0%</span>
                      <span>50%</span>
                      <span>100%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Initial Activity Scheduling */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <div className="pb-2 border-b border-[#111111]">
                    <label className="flex items-center space-x-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={wizardActivity.log_activity}
                        onChange={(e) => setWizardActivity({ ...wizardActivity, log_activity: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-5 h-5 border border-[#1c1c1c] peer-checked:border-[#D4AF37] peer-checked:bg-[#D4AF37]/10 flex items-center justify-center transition-all bg-[#0a0a0a]">
                        {wizardActivity.log_activity && <Check className="w-3.5 h-3.5 text-[#D4AF37]" />}
                      </div>
                      <span className="text-xs font-mono text-slate-light uppercase tracking-wider group-hover:text-white transition-colors">
                        Schedule Initial Action Item
                      </span>
                    </label>
                  </div>

                  {wizardActivity.log_activity && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-250">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-mono text-slate-light uppercase">Activity Type *</label>
                          <select
                            value={wizardActivity.type}
                            onChange={(e) => setWizardActivity({ ...wizardActivity, type: e.target.value })}
                            className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none"
                          >
                            <option value="Call">Call</option>
                            <option value="Meeting">Meeting</option>
                            <option value="Site Visit">Site Visit</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-xs font-mono text-slate-light uppercase">Due Date & Time *</label>
                          <div className="flex space-x-2">
                            <input
                              type="date"
                              required={wizardActivity.log_activity}
                              value={wizardActivity.due_date}
                              onChange={(e) => setWizardActivity({ ...wizardActivity, due_date: e.target.value })}
                              className="flex-1 bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-2 py-1.5 text-xs text-white focus:outline-none font-mono"
                            />
                            <input
                              type="time"
                              required={wizardActivity.log_activity}
                              value={wizardActivity.due_time}
                              onChange={(e) => setWizardActivity({ ...wizardActivity, due_time: e.target.value })}
                              className="w-24 bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-2 py-1.5 text-xs text-white focus:outline-none font-mono"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-mono text-slate-light uppercase">Action Details / Notes</label>
                        <textarea
                          value={wizardActivity.notes}
                          onChange={(e) => setWizardActivity({ ...wizardActivity, notes: e.target.value })}
                          placeholder="e.g. Schedule meeting to discuss heavy-equipment specifications..."
                          rows={3}
                          className="w-full bg-[#0a0a0a] border border-[#1c1c1c] focus:border-[#D4AF37] px-3 py-2 text-sm text-white focus:outline-none resize-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="border-t border-[#1c1c1c] p-6 bg-[#0a0a0a] flex justify-between items-center">
              <div>
                {wizardStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep(prev => prev - 1)}
                    className="px-4 py-2 border border-[#1c1c1c] hover:border-slate-light text-slate-light hover:text-white font-mono text-xs uppercase transition-colors"
                  >
                    Back
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsQualifyWizardOpen(false)}
                    className="px-4 py-2 border border-[#1c1c1c] hover:border-slate-light text-slate-light hover:text-white font-mono text-xs uppercase transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-3">
                {wizardStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep(prev => prev + 1)}
                    className="px-6 py-2 bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-[#050505] font-mono text-xs font-bold uppercase transition-colors flex items-center"
                  >
                    Next Step
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleWizardSubmit}
                    disabled={qualifyingId !== null}
                    className="px-6 py-2 bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-[#050505] font-mono text-xs font-bold uppercase transition-colors flex items-center"
                  >
                    {qualifyingId !== null ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> PROCESSING...</>
                    ) : (
                      'Qualify & Convert'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
