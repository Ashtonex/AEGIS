"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FileText, Plus, X, ChevronLeft, ChevronRight,
  DollarSign, Clock, ShieldCheck, CheckSquare,
  Briefcase, UserCheck, AlertTriangle, Loader2, Save,
  Calendar, Users, Info, ToggleLeft, ToggleRight, Search, Landmark, ShieldAlert, Trash2,
  Eye, Download
} from 'lucide-react';
import {
  ApiError,
  getCrmTenders,
  createCrmTender,
  updateCrmTender,
  deleteCrmTender,
  awardCrmTender,
  getFinanceDepartments,
  getTenderRequirements,
  createTenderRequirement,
  toggleTenderRequirement,
  deleteTenderRequirement,
  getDocuments,
  createDocument,
  getDocumentSignedUrl,
  describeActionError
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { AssignmentPanel } from '@/components/documents/AssignmentPanel';

// Stages definition. 'Awarded' and 'Lost' used to be a single combined
// 'Awarded/Lost' stage with no conversion logic - now moving into 'Awarded'
// triggers the award handoff (creates/links a real project), while 'Lost'
// stays a plain stage move.
const STAGES = [
  'Tender Identified',
  'Bid Prep',
  'Submitted',
  'Adjudication',
  'Awarded',
  'Lost'
];

const RESOLVED_STAGES = ['Awarded', 'Lost', 'Awarded/Lost'];
const POST_SUBMISSION_STAGES = ['Submitted', 'Adjudication', ...RESOLVED_STAGES];
const isPostSubmissionStage = (stage: string) => POST_SUBMISSION_STAGES.includes(stage);

const CATEGORIES = [
  'Civil Works',
  'Mechanical Engineering',
  'Electrical Installation',
  'Structural Steel',
  'Supply & Delivery',
  'General Building'
];

interface Tender {
  id: string;
  tender_name: string;
  bid_number?: string;
  category?: string;
  bid_amount: number | string | null;
  stage: string;
  project_id?: string | null;
  submission_deadline?: string;
  bid_bond_secured: boolean;
  jv_partners?: string;
  bond_amount?: number | string | null;
  technical_proposal: boolean;
  financial_proposal: boolean;
  nssa_clearance: boolean;
  praz_registration: boolean;
  tax_clearance: boolean;
  created_at: string;
}

interface TenderRequirement {
  id: string;
  tender_id: string;
  label: string;
  is_satisfied: boolean;
  sort_order: number;
  satisfied_document_id?: string | null;
}

export default function TendersCommand() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [isDeleteTenderModalOpen, setIsDeleteTenderModalOpen] = useState(false);
  const [isDeletingTender, setIsDeletingTender] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Award modal state - moving a tender into 'Awarded' creates/links a real
  // project, so it's gated behind this modal instead of a plain stage move.
  const [isAwardModalOpen, setIsAwardModalOpen] = useState(false);
  const [awardTenderId, setAwardTenderId] = useState<string | null>(null);
  const [awardDepartmentOptions, setAwardDepartmentOptions] = useState<any[]>([]);
  const [selectedAwardDepartmentId, setSelectedAwardDepartmentId] = useState('');
  const [selectedAwardOriginatingDepartmentId, setSelectedAwardOriginatingDepartmentId] = useState('');
  const [isAwarding, setIsAwarding] = useState(false);

  // Requirements checklist state
  const [requirements, setRequirements] = useState<TenderRequirement[]>([]);
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(false);
  const [newRequirementLabel, setNewRequirementLabel] = useState('');

  // Tender documents state
  const [tenderDocuments, setTenderDocuments] = useState<any[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string; isImage: boolean } | null>(null);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedBondStatus, setSelectedBondStatus] = useState('All');
  const [liabilityRange, setLiabilityRange] = useState('All');

  // Drag and Drop hover state
  const [draggedOverStage, setDraggedOverStage] = useState<string | null>(null);

  // Form State
  const [newTender, setNewTender] = useState({
    tender_name: '',
    bid_number: '',
    category: 'Civil Works',
    stage: 'Tender Identified',
    bid_amount: '',
    submission_deadline: '',
    bid_bond_secured: false,
    jv_partners: '',
    bond_amount: '',
    technical_proposal: false,
    financial_proposal: false,
    nssa_clearance: false,
    praz_registration: false,
    tax_clearance: false
  });

  // Edit Drawer Form State
  const [editForm, setEditForm] = useState<Tender | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getCrmTenders();
      if (res.success && Array.isArray(res.data)) {
        setTenders(res.data);
      }
    } catch (error) {
      console.error('Error loading CRM tenders data:', error);
      setLoadError(describeActionError(
        error,
        "You don't have permission to view Tenders & Bids.",
        "Tenders could not be loaded. Check the CRM service connection and retry."
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const getStageBidSum = (stage: string) => {
    return filteredTenders
      .filter(t => t.stage === stage)
      .reduce((sum, t) => sum + (Number(t.bid_amount) || 0), 0);
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, tenderId: string) => {
    e.dataTransfer.setData('text/plain', tenderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDraggedOverStage(stage);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggedOverStage(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    setDraggedOverStage(null);
    const tenderId = e.dataTransfer.getData('text/plain');
    if (!tenderId) return;

    const tender = tenders.find(t => t.id === tenderId);
    if (!tender) return;
    if (tender.stage === targetStage) return;

    if (targetStage === 'Awarded' && !tender.project_id) {
      handleOpenAward(tenderId);
      return;
    }

    // Optimistically update local state
    setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, stage: targetStage } : t));

    try {
      const res = await updateCrmTender(tenderId, { stage: targetStage });
      if (!res.success) {
        loadData();
      }
    } catch (err) {
      console.error('Failed to update stage via drag-drop:', err);
      alert(describeActionError(
        err,
        "You don't have permission to move this tender - it's been put back where it was.",
        "The stage move didn't save. Check the CRM service connection and retry."
      ));
      loadData();
    }
  };

  const handleOpenAward = async (tenderId: string) => {
    setAwardTenderId(tenderId);
    setSelectedAwardDepartmentId('');
    setSelectedAwardOriginatingDepartmentId('');
    setIsAwardModalOpen(true);
    try {
      const res = await getFinanceDepartments();
      if (res.success && Array.isArray(res.data)) setAwardDepartmentOptions(res.data);
    } catch {
      setAwardDepartmentOptions([]);
    }
  };

  const handleConfirmAward = async () => {
    if (!awardTenderId) return;
    setIsAwarding(true);
    try {
      const result = await awardCrmTender(awardTenderId, {
        create_project: true,
        department_id: selectedAwardDepartmentId || undefined,
        originating_department_id: selectedAwardOriginatingDepartmentId || undefined,
      });
      setIsAwardModalOpen(false);
      const budgetPendingReason = result?.data?.budget_pending_reason;
      if (budgetPendingReason) {
        // The award itself always goes through - this only flags that the
        // project's execution budget wasn't auto-seeded (segregation of
        // duties, or an unpriced BOQ) and still needs a second person to
        // confirm it via Quotations > Decision.
        alert(`Tender awarded. Budget not yet seeded: ${budgetPendingReason}`);
      }
      await loadData();
    } catch (err) {
      console.error('Failed to award tender:', err);
      alert(describeActionError(
        err,
        "You don't have permission to award this tender - awarding creates a real project commitment, so it needs sign-off from a manager or exec.",
        "Tender was not awarded. Check the CRM service connection and retry."
      ));
    } finally {
      setIsAwarding(false);
    }
  };

  // The backend returns submission_deadline as a UTC-offset ISO string
  // (e.g. "2026-09-01T12:30:00+00:00"). A <input type="datetime-local">
  // needs "YYYY-MM-DDTHH:MM" in the *browser's local time* - naively
  // slicing the raw string's first 16 characters displays the UTC wall
  // clock time mislabeled as local, silently shifting the deadline by the
  // user's UTC offset the moment they touch the field again.
  const toLocalDatetimeInputValue = (isoString?: string | null) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const getCountdown = (deadlineStr?: string) => {
    if (!deadlineStr) return { text: 'N/A', urgency: 'none' };
    
    const deadline = new Date(deadlineStr).getTime();
    const now = new Date().getTime();
    const diff = deadline - now;
    
    if (diff <= 0) return { text: 'LAPSED', urgency: 'critical' };
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days === 0) {
      return { text: `${hours}h remaining`, urgency: 'warning' };
    }
    if (days <= 3) {
      return { text: `${days}d ${hours}h left`, urgency: 'warning' };
    }
    return { text: `${days}d left`, urgency: 'normal' };
  };

  const getTenderTimingStatus = (tender: Pick<Tender, 'stage' | 'submission_deadline'>) => {
    if (isPostSubmissionStage(tender.stage)) {
      if (tender.stage === 'Submitted') return { text: 'Submitted for review', urgency: 'submitted' };
      if (tender.stage === 'Adjudication') return { text: 'Under adjudication', urgency: 'submitted' };
      if (tender.stage === 'Awarded' || tender.stage === 'Awarded/Lost') return { text: 'Awarded', urgency: 'resolved' };
      if (tender.stage === 'Lost') return { text: 'Closed - not awarded', urgency: 'resolved' };
    }
    return getCountdown(tender.submission_deadline);
  };

  const getChecklistCount = (t: Tender) => {
    let count = 0;
    if (t.technical_proposal) count++;
    if (t.financial_proposal) count++;
    if (t.nssa_clearance) count++;
    if (t.praz_registration) count++;
    if (t.tax_clearance) count++;
    return count;
  };

  const handleStageMove = async (tenderId: string, currentStage: string, direction: 'prev' | 'next') => {
    const currentIndex = STAGES.indexOf(currentStage);
    if (currentIndex === -1) return;
    
    let nextIndex = currentIndex;
    if (direction === 'prev' && currentIndex > 0) nextIndex--;
    if (direction === 'next' && currentIndex < STAGES.length - 1) nextIndex++;
    
    if (nextIndex === currentIndex) return;
    const nextStage = STAGES[nextIndex];

    const tender = tenders.find(t => t.id === tenderId);
    if (nextStage === 'Awarded' && !tender?.project_id) {
      handleOpenAward(tenderId);
      return;
    }

    // Optimistically update state
    setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, stage: nextStage } : t));

    try {
      const res = await updateCrmTender(tenderId, { stage: nextStage });
      if (!res.success) {
        loadData();
      }
    } catch (err) {
      console.error('Failed to update stage:', err);
      alert(describeActionError(
        err,
        "You don't have permission to move this tender - it's been put back where it was.",
        "The stage move didn't save. Check the CRM service connection and retry."
      ));
      loadData();
    }
  };

  const handleCreateTender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTender.tender_name.trim()) return;

    setIsSubmitting(true);
    try {
      const payload: any = {
        tender_name: newTender.tender_name.trim(),
        stage: newTender.stage
      };
      if (newTender.bid_amount.trim() !== '') {
        payload.bid_amount = Number(newTender.bid_amount);
      }

      const res = await createCrmTender(payload);

      if (res.success && (res.data as any)?.id) {
        const generatedId = (res.data as any).id;

        // Update all specific bid board columns
        const extraPayload: any = {
          bid_number: newTender.bid_number.trim() || `BID-2026-${generatedId.substring(0, 5).toUpperCase()}`,
          category: newTender.category,
          bid_bond_secured: newTender.bid_bond_secured,
          jv_partners: newTender.jv_partners.trim() || null,
          bond_amount: newTender.bond_amount.trim() !== '' ? Number(newTender.bond_amount) : null,
          technical_proposal: newTender.technical_proposal,
          financial_proposal: newTender.financial_proposal,
          nssa_clearance: newTender.nssa_clearance,
          praz_registration: newTender.praz_registration,
          tax_clearance: newTender.tax_clearance
        };

        if (newTender.submission_deadline) {
          extraPayload.submission_deadline = new Date(newTender.submission_deadline).toISOString();
        }

        const extraRes = await updateCrmTender(generatedId, extraPayload);
        if (!extraRes.success) {
          // The tender itself was created (generatedId is real) - only the
          // extra fields (category, deadline, bond, checklist...) failed to
          // save. Surfacing this distinctly instead of silently proceeding
          // as if everything succeeded, or letting it read as a total
          // failure when a real tender now exists half-filled-in.
          alert("Tender was logged, but its extra details (category, deadline, bond, checklist) did not save. Open it from the board and fill them in again.");
        }

        // Reset state
        setNewTender({
          tender_name: '',
          bid_number: '',
          category: 'Civil Works',
          stage: 'Tender Identified',
          bid_amount: '',
          submission_deadline: '',
          bid_bond_secured: false,
          jv_partners: '',
          bond_amount: '',
          technical_proposal: false,
          financial_proposal: false,
          nssa_clearance: false,
          praz_registration: false,
          tax_clearance: false
        });
        setIsModalOpen(false);
        await loadData();
      }
    } catch (err) {
      console.error('Failed to create tender:', err);
      if (err instanceof ApiError && err.status === 409) {
        alert(`A tender named "${newTender.tender_name.trim()}" already exists on the board. Open it from a stage column instead of logging it again.`);
      } else {
        alert(describeActionError(
          err,
          "You don't have permission to log tenders.",
          "Tender was not logged. Check the CRM service connection and retry."
        ));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateTenderDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenderId || !editForm) return;

    setIsSubmitting(true);
    try {
      const bidAmountStr = String(editForm.bid_amount ?? '').trim();
      const bondAmountStr = String(editForm.bond_amount ?? '').trim();

      const payload: any = {
        tender_name: editForm.tender_name,
        bid_number: editForm.bid_number || '',
        category: editForm.category || 'Civil Works',
        stage: editForm.stage,
        bid_amount: bidAmountStr !== '' ? Number(bidAmountStr) : null,
        bid_bond_secured: editForm.bid_bond_secured,
        jv_partners: editForm.jv_partners || null,
        bond_amount: bondAmountStr !== '' ? Number(bondAmountStr) : null,
        technical_proposal: editForm.technical_proposal,
        financial_proposal: editForm.financial_proposal,
        nssa_clearance: editForm.nssa_clearance,
        praz_registration: editForm.praz_registration,
        tax_clearance: editForm.tax_clearance
      };

      if (editForm.submission_deadline) {
        payload.submission_deadline = new Date(editForm.submission_deadline).toISOString();
      } else {
        payload.submission_deadline = null;
      }

      const res = await updateCrmTender(selectedTenderId, payload);
      if (res.success) {
        await loadData();
      }
    } catch (err) {
      console.error('Failed to update tender details:', err);
      alert(describeActionError(
        err,
        "You don't have permission to edit this tender.",
        "Tender details were not saved. Check the CRM service connection and retry."
      ));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTender = async () => {
    if (!selectedTenderId) return;
    setIsDeletingTender(true);
    try {
      const res = await deleteCrmTender(selectedTenderId);
      if (!res.success) throw new Error(res.message || "Delete failed");
      setTenders(prev => prev.filter(t => t.id !== selectedTenderId));
      setSelectedTenderId(null);
      setIsDeleteTenderModalOpen(false);
    } catch (err) {
      console.error('Failed to delete tender:', err);
      alert(describeActionError(
        err,
        "You don't have permission to delete tenders.",
        "Tender was not deleted. Check the CRM service connection and retry."
      ));
    } finally {
      setIsDeletingTender(false);
    }
  };

  const toggleChecklistItem = async (tenderId: string, itemKey: keyof Tender) => {
    const tender = tenders.find(t => t.id === tenderId);
    if (!tender) return;

    const currentVal = !!tender[itemKey];
    const newVal = !currentVal;

    // Optimistically update
    setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, [itemKey]: newVal } as Tender : t));
    if (editForm && editForm.id === tenderId) {
      setEditForm(prev => prev ? ({ ...prev, [itemKey]: newVal } as Tender) : null);
    }

    try {
      const res = await updateCrmTender(tenderId, { [itemKey]: newVal });
      if (!res.success) {
        loadData();
      }
    } catch (err) {
      console.error(`Failed to toggle ${itemKey}:`, err);
      loadData();
    }
  };

  useEffect(() => {
    if (!selectedTenderId) {
      setRequirements([]);
      return;
    }
    setIsLoadingRequirements(true);
    getTenderRequirements(selectedTenderId)
      .then(res => setRequirements(res.success ? (res.data as TenderRequirement[]) : []))
      .catch(() => setRequirements([]))
      .finally(() => setIsLoadingRequirements(false));
  }, [selectedTenderId]);

  const handleAddRequirement = async () => {
    const label = newRequirementLabel.trim();
    if (!label || !selectedTenderId) return;
    setNewRequirementLabel('');
    try {
      const res = await createTenderRequirement(selectedTenderId, label);
      if (res.success) {
        setRequirements(prev => [...prev, { id: (res.data as any).id, tender_id: selectedTenderId, label, is_satisfied: false, sort_order: prev.length }]);
      }
    } catch (err) {
      console.error('Failed to add requirement:', err);
      alert(describeActionError(err, "You don't have permission to edit this tender.", "Requirement was not saved. Check the CRM service connection and retry."));
    }
  };

  const handleToggleRequirement = async (req: TenderRequirement) => {
    if (!selectedTenderId) return;
    const newVal = !req.is_satisfied;
    setRequirements(prev => prev.map(r => r.id === req.id ? { ...r, is_satisfied: newVal } : r));
    try {
      const res = await toggleTenderRequirement(selectedTenderId, req.id, newVal);
      if (!res.success) {
        setRequirements(prev => prev.map(r => r.id === req.id ? { ...r, is_satisfied: req.is_satisfied } : r));
      }
    } catch (err) {
      console.error('Failed to toggle requirement:', err);
      setRequirements(prev => prev.map(r => r.id === req.id ? { ...r, is_satisfied: req.is_satisfied } : r));
    }
  };

  const handleDeleteRequirement = async (req: TenderRequirement) => {
    if (!selectedTenderId) return;
    setRequirements(prev => prev.filter(r => r.id !== req.id));
    try {
      const res = await deleteTenderRequirement(selectedTenderId, req.id);
      if (!res.success) {
        setRequirements(prev => [...prev, req]);
      }
    } catch (err) {
      console.error('Failed to delete requirement:', err);
      setRequirements(prev => [...prev, req]);
    }
  };

  const loadTenderDocuments = async (tenderId: string) => {
    setIsLoadingDocuments(true);
    try {
      const res = await getDocuments({ tender_id: tenderId });
      setTenderDocuments(res.success ? (res.data as any[]) : []);
    } catch (err) {
      console.error('Failed to load tender documents:', err);
      setTenderDocuments([]);
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  useEffect(() => {
    if (!selectedTenderId) {
      setTenderDocuments([]);
      return;
    }
    loadTenderDocuments(selectedTenderId);
  }, [selectedTenderId]);

  const handleUploadTenderDocument = async (file: File) => {
    if (!selectedTenderId) return;
    setIsUploadingDocument(true);
    try {
      const fileExt = file.name.split('.').pop();
      const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${fileExt ? `.${fileExt}` : ''}`;
      const filePath = `documents/${storedName}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;

      await createDocument({
        title: file.name,
        category: 'tender',
        tender_id: selectedTenderId,
        file_name: file.name,
        file_size_bytes: file.size,
        storage_path: filePath,
        mime_type: file.type || undefined,
      });
      await loadTenderDocuments(selectedTenderId);
    } catch (err) {
      console.error('Failed to upload document:', err);
      alert(describeActionError(err, "You don't have permission to upload documents.", "Document upload failed. Check the CRM service connection and retry."));
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const handleDownloadTenderDocument = async (docId: string) => {
    try {
      const res = await getDocumentSignedUrl(docId);
      if (res.success && res.data?.url) {
        window.open(res.data.url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('Failed to get document link:', err);
    }
  };

  const isPreviewableFile = (name?: string) => /\.(pdf|png|jpe?g|gif|webp)$/i.test(name || '');
  const isImageFile = (name?: string) => /\.(png|jpe?g|gif|webp)$/i.test(name || '');

  const handlePreviewTenderDocument = async (doc: any) => {
    try {
      const res = await getDocumentSignedUrl(doc.id);
      if (res.success && res.data?.url) {
        setPreviewDoc({ title: doc.title || doc.file_name, url: res.data.url, isImage: isImageFile(doc.file_name) });
      }
    } catch (err) {
      console.error('Failed to get preview link:', err);
    }
  };

  // Filter application
  const filteredTenders = tenders.filter(t => {
    // Search query matches title, bid number or JV partners
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = searchQuery === '' || 
      t.tender_name.toLowerCase().includes(searchLower) ||
      (t.bid_number && t.bid_number.toLowerCase().includes(searchLower)) ||
      (t.jv_partners && t.jv_partners.toLowerCase().includes(searchLower));

    // Category filter
    const matchesCategory = selectedCategory === 'All' || t.category === selectedCategory;

    // Bid bond status
    let matchesBond = true;
    if (selectedBondStatus === 'Secured') {
      matchesBond = t.bid_bond_secured;
    } else if (selectedBondStatus === 'Pending') {
      matchesBond = !t.bid_bond_secured;
    }

    // Security liability range
    const bondVal = Number(t.bond_amount) || 0;
    let matchesLiability = true;
    if (liabilityRange === 'Low') {
      matchesLiability = bondVal < 10000;
    } else if (liabilityRange === 'Mid') {
      matchesLiability = bondVal >= 10000 && bondVal <= 50000;
    } else if (liabilityRange === 'High') {
      matchesLiability = bondVal > 50000;
    }

    return matchesSearch && matchesCategory && matchesBond && matchesLiability;
  });

  const selectedTender = tenders.find(t => t.id === selectedTenderId);
  const selectedTenderTimingStatus = selectedTender ? getTenderTimingStatus(selectedTender) : null;

  // Initialize edit drawer form when drawer opens
  useEffect(() => {
    if (selectedTender) {
      setEditForm({ ...selectedTender });
    } else {
      setEditForm(null);
    }
  }, [selectedTender]);

  // Analytics helper values
  const totalBidAmount = tenders.reduce((sum, t) => sum + (Number(t.bid_amount) || 0), 0);
  
  // Outstanding liabilities is only active if bid bond is secured AND tender stage is not yet resolved (unreleased risk)
  const totalLiabilities = tenders
    .filter(t => t.bid_bond_secured && !RESOLVED_STAGES.includes(t.stage))
    .reduce((sum, t) => sum + (Number(t.bond_amount) || 0), 0);

  const activeBondsCount = tenders.filter(t => t.bid_bond_secured).length;

  if (isLoading && tenders.length === 0) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#D4AF37] animate-spin mb-4" />
        <span className="font-mono text-xs text-slate-light tracking-widest uppercase">Syncing Bidding Ledger...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-paper p-6 relative overflow-hidden flex flex-col">

      {/* Header */}
      <header className="flex justify-between items-end border-b border-white/5 pb-4 mb-6 relative z-10 shrink-0">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse"></span>
            <span className="font-mono text-[9px] text-[#3B82F6] uppercase tracking-widest">Construction procurement bids</span>
          </div>
          <h1 className="font-sans font-black text-2xl tracking-tight text-paper uppercase">
            Tenders & Bids Board
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          <Link
            href="/dashboard/crm"
            className="px-3.5 py-1.5 border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] rounded-sm text-[10px] font-mono tracking-widest text-slate-light uppercase transition-all"
          >
            ← Back to Command
          </Link>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-[#D4AF37] text-black hover:bg-[#D4AF37]/90 rounded-sm text-[10px] font-mono tracking-widest uppercase font-bold transition-all shadow-[0_0_15px_rgba(212,175,55,0.2)]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Tender</span>
          </button>
        </div>
      </header>

      {/* Overview Analytics Row */}
      <div className="grid grid-cols-4 gap-2 mb-6 shrink-0 z-10">
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-slate-light uppercase tracking-wider mb-1">Total Bid Book Value</span>
          <span className="font-mono text-lg font-bold text-paper tabular-nums">
            ${totalBidAmount.toLocaleString()}
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider mb-1">Active Bid Bonds</span>
          <span className="font-mono text-lg font-bold text-[#D4AF37] tabular-nums">
            {activeBondsCount} <span className="text-xs text-slate font-normal">secured</span>
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#EF4444] uppercase tracking-wider mb-1">Outstanding Liability Risk</span>
          <span className="font-mono text-lg font-bold text-[#EF4444] tabular-nums">
            ${totalLiabilities.toLocaleString()}
          </span>
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-sm">
          <span className="block font-mono text-[9px] text-[#3B82F6] uppercase tracking-wider mb-1">Checklist Compliance</span>
          <span className="font-mono text-lg font-bold text-[#3B82F6] tabular-nums">
            {tenders.length > 0 
              ? `${(tenders.reduce((sum, t) => sum + getChecklistCount(t), 0) / (tenders.length * 5) * 100).toFixed(0)}%`
              : '0%'
            }
          </span>
        </div>
      </div>

      {/* Search and Filters panel */}
      <div className="bg-[#0A0A0A] border border-white/5 p-4 rounded-sm mb-6 flex flex-col lg:flex-row gap-4 justify-between items-center shrink-0 z-10">
        <div className="w-full lg:w-1/4 relative">
          <input
            type="text"
            placeholder="Search bid name, number, JV..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-black border border-white/10 rounded-sm pl-9 pr-8 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all placeholder:text-slate"
          />
          <Search className="w-4 h-4 text-slate absolute left-3 top-2.5" />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-slate hover:text-paper"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none"
          >
            <option value="All">All Categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {/* Bid Bond Filter */}
          <select
            value={selectedBondStatus}
            onChange={e => setSelectedBondStatus(e.target.value)}
            className="bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none"
          >
            <option value="All">All Bonds</option>
            <option value="Secured">Bond Secured</option>
            <option value="Pending">Bond Pending</option>
          </select>

          {/* Security Liability Range */}
          <select
            value={liabilityRange}
            onChange={e => setLiabilityRange(e.target.value)}
            className="bg-black border border-white/10 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none"
          >
            <option value="All">All Liabilities</option>
            <option value="Low">Low (&lt;$10k)</option>
            <option value="Mid">Medium ($10k-$50k)</option>
            <option value="High">High (&gt;$50k)</option>
          </select>

          {/* Clear Filters Button */}
          {(searchQuery || selectedCategory !== 'All' || selectedBondStatus !== 'All' || liabilityRange !== 'All') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('All');
                setSelectedBondStatus('All');
                setLiabilityRange('All');
              }}
              className="text-[9px] font-mono text-[#D4AF37] hover:underline uppercase transition-all px-2 py-1.5"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mb-4 px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="font-mono text-xs text-rose-200">{loadError}</span>
        </div>
      )}

      {/* Bid Board Kanban Board */}
      <div className="flex-1 overflow-x-auto flex gap-4 pb-4 items-start min-h-0 select-none">
        {STAGES.map(stage => {
          const stageTenders = filteredTenders.filter(t => t.stage === stage);
          const stageSum = getStageBidSum(stage);

          return (
            <div 
              key={stage}
              onDragOver={(e) => handleDragOver(e, stage)}
              onDragEnter={(e) => handleDragEnter(e, stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage)}
              className={`flex-1 min-w-[290px] max-w-[330px] rounded-sm p-3 flex flex-col max-h-full min-h-[400px] transition-all duration-200 ${
                draggedOverStage === stage 
                  ? 'bg-[#181a1f] border border-[#3B82F6]/40 shadow-[0_0_20px_rgba(59,130,246,0.08)] scale-[1.01]' 
                  : 'bg-[#0A0A0A]/80 border border-white/5'
              }`}
            >
              {/* Stage header */}
              <div className="flex justify-between items-center pb-2.5 mb-3 border-b border-white/5 shrink-0">
                <div>
                  <h3 className="font-sans font-bold text-xs text-paper uppercase tracking-wider">{stage}</h3>
                  <span className="font-mono text-[9px] text-[#3B82F6] tabular-nums tracking-widest mt-0.5 block">
                    ${stageSum.toLocaleString()}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate bg-white/5 px-2 py-0.5 rounded-full">{stageTenders.length}</span>
              </div>

              {/* Cards list */}
              <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1 min-h-0">
                {stageTenders.map(t => {
                  const timingStatus = getTenderTimingStatus(t);
                  const progress = getChecklistCount(t);
                  const bondVal = Number(t.bond_amount) || 0;
                  const isLiabilityOutstanding = t.bid_bond_secured && !RESOLVED_STAGES.includes(t.stage);

                  return (
                    <div 
                      key={t.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, t.id)}
                      onClick={() => setSelectedTenderId(t.id)}
                      className="group bg-[#111111] border border-white/5 hover:border-[#3B82F6]/30 p-3.5 rounded-sm cursor-grab active:cursor-grabbing hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] transform hover:-translate-y-0.5 duration-150 transition-all relative"
                    >
                      <div className="flex justify-between items-start mb-1.5 gap-2">
                        <span className="text-[9px] font-mono text-[#D4AF37] tracking-wider block font-bold truncate max-w-[120px]">
                          {t.bid_number || `BID-${t.id.substring(0, 5).toUpperCase()}`}
                        </span>
                        
                        {t.category && (
                          <span className="text-[7.5px] font-mono text-[#3B82F6] border border-[#3B82F6]/20 bg-[#3B82F6]/5 px-1 py-0.5 rounded-sm shrink-0 uppercase tracking-widest">
                            {t.category}
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-paper line-clamp-2 pr-2 group-hover:text-[#D4AF37] transition-colors mb-2">
                        {t.tender_name}
                      </h4>

                      {t.project_id && (
                        <Link
                          href={`/dashboard/projects?id=${t.project_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 mb-2 px-1.5 py-0.5 rounded-sm text-[8px] font-mono uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                        >
                          <Briefcase className="w-2.5 h-2.5" /> Project Live
                        </Link>
                      )}

                      {/* Display Bid details */}
                      <div className="space-y-1.5 my-3 text-[10px] text-slate-light font-mono">
                        <div className="flex justify-between">
                          <span>Bid Value:</span>
                          <span className="text-paper font-bold">
                            {t.bid_amount === null || t.bid_amount === undefined || t.bid_amount === ''
                              ? <span className="text-[#D4AF37]">TBD - Pending BOQ</span>
                              : `$${Number(t.bid_amount).toLocaleString()}`}
                          </span>
                        </div>
                        
                        <div className="flex justify-between items-center">
                          <span>Bid Bond Status:</span>
                          <span className={`px-1.5 py-0.2 rounded-sm text-[8px] font-bold ${
                            t.bid_bond_secured 
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {t.bid_bond_secured ? 'SECURED' : 'PENDING'}
                          </span>
                        </div>

                        {bondVal > 0 && (
                          <div className="flex justify-between items-center">
                            <span>Liability:</span>
                            <span className={`font-semibold flex items-center ${isLiabilityOutstanding ? 'text-[#EF4444]' : 'text-slate-light'}`}>
                              ${bondVal.toLocaleString()}
                              {isLiabilityOutstanding && (
                                <ShieldAlert className="w-3.5 h-3.5 ml-1 text-[#EF4444] animate-pulse" />
                              )}
                            </span>
                          </div>
                        )}

                        {t.jv_partners && (
                          <div className="flex justify-between items-center">
                            <span>JV Partners:</span>
                            <span className="text-paper truncate max-w-[140px]">{t.jv_partners}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span>Checklist:</span>
                          <span className={`px-1.5 py-0.5 rounded-sm text-[9px] ${
                            progress === 5 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-white/5 text-slate-light'
                          }`}>{progress}/5 complete</span>
                        </div>
                      </div>

                      {/* Footer with bid timing/status */}
                      <div className="flex justify-between items-end border-t border-white/5 pt-2.5 mt-2">
                        {t.submission_deadline || isPostSubmissionStage(t.stage) ? (
                          <div className="flex items-center space-x-1.5">
                            <Clock className={`w-3.5 h-3.5 ${
                              timingStatus.urgency === 'critical' ? 'text-red-500 animate-pulse' :
                              timingStatus.urgency === 'warning' ? 'text-[#D4AF37]' :
                              timingStatus.urgency === 'submitted' ? 'text-emerald-400' : 'text-[#3B82F6]'
                            }`} />
                            <span className={`font-mono text-[9px] ${
                              timingStatus.urgency === 'critical' ? 'text-red-400 font-bold' :
                              timingStatus.urgency === 'warning' ? 'text-[#D4AF37]' :
                              timingStatus.urgency === 'submitted' ? 'text-emerald-300' : 'text-slate-light'
                            }`}>{timingStatus.text}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-[8px] text-slate">NO DEADLINE</span>
                        )}

                        {/* Quick stage controllers */}
                        <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                          <button
                            disabled={STAGES.indexOf(stage) === 0 || RESOLVED_STAGES.includes(stage)}
                            onClick={() => handleStageMove(t.id, stage, 'prev')}
                            className="w-5 h-5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-sm flex items-center justify-center transition-all text-slate-light"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button
                            disabled={RESOLVED_STAGES.includes(stage)}
                            onClick={() => handleStageMove(t.id, stage, 'next')}
                            className="w-5 h-5 bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 disabled:opacity-30 disabled:pointer-events-none rounded-sm flex items-center justify-center transition-all text-slate-light"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {stageTenders.length === 0 && (
                  <div className="h-28 border border-dashed border-white/5 rounded-sm flex flex-col items-center justify-center opacity-40">
                    <span className="font-mono text-[9px] text-slate uppercase">Drag bids here</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* LOG TENDER MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          
          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-lg rounded-sm shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-[#D4AF37]" />
                <h2 className="font-sans font-bold text-sm text-paper uppercase tracking-wider">Log Construction Bid / Tender</h2>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-light hover:text-paper transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTender} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Tender Name / Reference</label>
                <input 
                  required 
                  type="text" 
                  value={newTender.tender_name} 
                  onChange={e => setNewTender({ ...newTender, tender_name: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all placeholder:text-slate" 
                  placeholder="e.g. M.T.C.D Highway reconstruction" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Reference Number</label>
                  <input 
                    type="text" 
                    value={newTender.bid_number} 
                    onChange={e => setNewTender({ ...newTender, bid_number: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono" 
                    placeholder="e.g. TDR/2026/CIV-102" 
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Category</label>
                  <select
                    value={newTender.category} 
                    onChange={e => setNewTender({ ...newTender, category: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                  >
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Tender Stage</label>
                  <select 
                    value={newTender.stage} 
                    onChange={e => setNewTender({ ...newTender, stage: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                  >
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Submission Deadline</label>
                  <input 
                    type="datetime-local" 
                    value={newTender.submission_deadline} 
                    onChange={e => setNewTender({ ...newTender, submission_deadline: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Amount ($)</label>
                  <input
                    type="number"
                    value={newTender.bid_amount}
                    onChange={e => setNewTender({ ...newTender, bid_amount: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                    placeholder="TBD - pending BOQ"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider font-bold text-[#D4AF37]">JV Partners</label>
                  <input 
                    type="text" 
                    value={newTender.jv_partners} 
                    onChange={e => setNewTender({ ...newTender, jv_partners: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all" 
                    placeholder="e.g. Group Five Ltd, Stefanutti" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-3">
                <div className="space-y-1.5">
                  <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Bond / Security Liability ($)</label>
                  <input 
                    type="number" 
                    value={newTender.bond_amount} 
                    onChange={e => setNewTender({ ...newTender, bond_amount: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                    placeholder="Bond liability USD" 
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center space-x-2.5 cursor-pointer text-xs font-mono select-none text-slate-light py-2">
                    <input 
                      type="checkbox" 
                      checked={newTender.bid_bond_secured} 
                      onChange={e => setNewTender({ ...newTender, bid_bond_secured: e.target.checked })}
                      className="rounded border-white/10 bg-black text-[#D4AF37] focus:ring-0 focus:ring-offset-0 focus:outline-none"
                    />
                    <span className="uppercase text-[9px] tracking-wider font-bold text-[#D4AF37]">Bid Bond Secured</span>
                  </label>
                </div>
              </div>

              {/* Initial Checklist states */}
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="block font-mono text-[9px] text-slate-light uppercase tracking-wider">Bid Deliverables Checklist</label>
                <div className="grid grid-cols-2 gap-2 bg-white/[0.01] border border-white/5 p-3 rounded-sm">
                  {[
                    { key: 'technical_proposal', label: 'Technical Proposal' },
                    { key: 'financial_proposal', label: 'Financial Proposal' },
                    { key: 'nssa_clearance', label: 'NSSA Clearance' },
                    { key: 'praz_registration', label: 'PRAZ Registration' },
                    { key: 'tax_clearance', label: 'Tax Clearance Certificate' }
                  ].map(item => (
                    <label key={item.key} className="flex items-center space-x-2 text-[10px] text-slate-light font-mono cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={!!(newTender as any)[item.key]} 
                        onChange={e => setNewTender({ ...newTender, [item.key]: e.target.checked })}
                        className="rounded border-white/10 bg-black text-[#D4AF37] focus:ring-0"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-white/5 flex justify-end space-x-2">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 font-mono text-[10px] text-slate-light hover:text-paper hover:bg-white/5 rounded-sm transition-all"
                >
                  CANCEL
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-[#D4AF37] text-black font-bold font-mono text-[10px] rounded-sm hover:bg-[#D4AF37]/90 disabled:opacity-50 transition-all uppercase"
                >
                  {isSubmitting ? 'PROCESSING...' : 'INITIALIZE TENDER'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAILED SLIDE-OUT EDIT DRAWER & CHECKLIST VALIDATOR */}
      <div className={`fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-[#0A0A0A] border-l border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.9)] transform transition-transform duration-300 ease-out flex flex-col ${
        selectedTenderId ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {selectedTender ? (
          <>
            {/* Drawer Header */}
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <div className="flex items-center space-x-2.5">
                <FileText className="w-4 h-4 text-[#D4AF37]" />
                <div>
                  <span className="font-mono text-[8px] text-slate-light uppercase tracking-wider block">Bidding Control Deck</span>
                  <h2 className="font-sans font-bold text-sm text-paper uppercase truncate max-w-[280px]">{selectedTender.tender_name}</h2>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => setIsDeleteTenderModalOpen(true)}
                  title="Delete tender"
                  className="w-7 h-7 bg-white/5 hover:bg-red-500/20 hover:text-red-300 rounded-full flex items-center justify-center text-slate-light transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setSelectedTenderId(null)}
                  className="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-slate-light hover:text-paper transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
              
              {/* EDIT FORM BLOCK */}
              {editForm && (
                <form onSubmit={handleUpdateTenderDetails} className="space-y-4 bg-white/[0.01] border border-white/5 p-4 rounded-sm">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider font-bold">Bid Parameters</span>
                    <button 
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center space-x-1 text-[9px] font-mono bg-white/5 hover:bg-[#D4AF37] hover:text-black border border-white/10 px-2.5 py-0.5 rounded-sm uppercase transition-all"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSubmitting ? 'Saving' : 'Save Details'}</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-mono text-[8px] text-slate-light uppercase">Tender Title / Reference</label>
                    <input 
                      type="text" 
                      value={editForm.tender_name} 
                      onChange={e => setEditForm({ ...editForm, tender_name: e.target.value })}
                      className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all" 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Bid Reference Number</label>
                      <input 
                        type="text" 
                        value={editForm.bid_number || ''} 
                        onChange={e => setEditForm({ ...editForm, bid_number: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono" 
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Category</label>
                      <select 
                        value={editForm.category || 'Civil Works'} 
                        onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all"
                      >
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Bidding Stage</label>
                      {/* 'Awarded' is deliberately not a plain option here - it
                          creates a real project, so it only happens via the
                          gated Award action (drag to the Awarded column, or
                          the button below), never a bare stage save. */}
                      <select
                        value={editForm.stage}
                        onChange={e => setEditForm({ ...editForm, stage: e.target.value })}
                        disabled={editForm.stage === 'Awarded'}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {STAGES.filter(s => s !== 'Awarded' || editForm.stage === 'Awarded').map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {editForm.stage !== 'Awarded' && editForm.stage !== 'Lost' && (
                        <button
                          type="button"
                          onClick={() => handleOpenAward(editForm.id)}
                          className="mt-1 flex items-center gap-1 text-[9px] font-mono text-emerald-400 hover:text-emerald-300 uppercase tracking-wider"
                        >
                          <Briefcase className="w-2.5 h-2.5" /> Award & Create Project
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Submission Deadline</label>
                      <input
                        type="datetime-local"
                        value={toLocalDatetimeInputValue(editForm.submission_deadline)}
                        onChange={e => setEditForm({ ...editForm, submission_deadline: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Total Bid Amount ($)</label>
                      <input
                        type="number"
                        value={editForm.bid_amount ?? ''}
                        onChange={e => setEditForm({ ...editForm, bid_amount: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all font-mono"
                        placeholder="TBD - pending BOQ"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase font-bold text-[#D4AF37]">JV Partners</label>
                      <input 
                        type="text" 
                        value={editForm.jv_partners || ''} 
                        onChange={e => setEditForm({ ...editForm, jv_partners: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none transition-all" 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block font-mono text-[8px] text-slate-light uppercase">Bid Bond / Liability ($)</label>
                      <input 
                        type="number" 
                        value={editForm.bond_amount || ''} 
                        onChange={e => setEditForm({ ...editForm, bond_amount: e.target.value })}
                        className="w-full bg-black border border-white/5 rounded-sm px-3 py-1.5 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono" 
                      />
                    </div>

                    <div className="flex flex-col justify-end">
                      <label className="flex items-center space-x-2.5 cursor-pointer text-xs font-mono select-none text-slate-light py-2">
                        <input 
                          type="checkbox" 
                          checked={editForm.bid_bond_secured} 
                          onChange={e => setEditForm({ ...editForm, bid_bond_secured: e.target.checked })}
                          className="rounded border-white/5 bg-black text-[#D4AF37] focus:ring-0"
                        />
                        <span className="uppercase text-[8px] font-bold text-[#D4AF37]">Bid Bond Secured</span>
                      </label>
                    </div>
                  </div>
                </form>
              )}

              {/* CHECKLIST VALIDATOR INTERFACE */}
              <div className="space-y-3 bg-[#0C0C0C] border border-white/5 p-4 rounded-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="block font-mono text-[9px] text-[#3B82F6] uppercase tracking-wider">Deliverable Compliance checks</span>
                  <span className="font-mono text-[10px] text-[#3B82F6] tabular-nums font-bold">
                    {((getChecklistCount(selectedTender) / 5) * 100).toFixed(0)}% VALID
                  </span>
                </div>

                <div className="space-y-2">
                  {[
                    { key: 'technical_proposal', label: 'Technical Proposal documentation', desc: 'SNC methodology, engineer CVs, schedule' },
                    { key: 'financial_proposal', label: 'Financial Proposal bill of quantities', desc: 'Fully populated itemized costings' },
                    { key: 'nssa_clearance', label: 'NSSA Compliance clearance letter', desc: 'National Social Security compliance audit' },
                    { key: 'praz_registration', label: 'PRAZ Procurement Authority registration', desc: 'Active category registry' },
                    { key: 'tax_clearance', label: 'ZIMRA Tax Clearance Certificate', desc: 'Valid tax clearance status token' }
                  ].map(item => {
                    const checked = !!(selectedTender as any)[item.key];
                    return (
                      <div 
                        key={item.key}
                        onClick={() => toggleChecklistItem(selectedTender.id, item.key as keyof Tender)}
                        className={`flex items-center justify-between p-2.5 border rounded-sm transition-all cursor-pointer ${
                          checked 
                            ? 'bg-[#D4AF37]/5 border-[#D4AF37]/30 hover:border-[#D4AF37]/50' 
                            : 'bg-black border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="pr-3">
                          <h4 className={`text-xs font-semibold font-sans ${checked ? 'text-[#D4AF37]' : 'text-paper'}`}>
                            {item.label}
                          </h4>
                          <p className="text-[9px] font-mono text-slate mt-0.5">{item.desc}</p>
                        </div>
                        <div className="shrink-0">
                          {checked ? (
                            <ToggleRight className="w-7 h-7 text-[#D4AF37]" />
                          ) : (
                            <ToggleLeft className="w-7 h-7 text-slate" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Freeform requirements checklist */}
              <div className="space-y-3 bg-[#0C0C0C] border border-white/5 p-4 rounded-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="block font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider">Tender Requirements</span>
                  {requirements.length > 0 && (
                    <span className="font-mono text-[10px] text-[#D4AF37] tabular-nums font-bold">
                      {requirements.filter(r => r.is_satisfied).length}/{requirements.length}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRequirementLabel}
                    onChange={e => setNewRequirementLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddRequirement(); } }}
                    placeholder="Add a requirement..."
                    className="flex-1 bg-black border border-white/10 rounded-sm px-3 py-2 text-xs text-paper focus:border-[#D4AF37] outline-none font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddRequirement}
                    disabled={!newRequirementLabel.trim()}
                    className="px-3 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-sm text-[#D4AF37] hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {isLoadingRequirements ? (
                  <div className="text-[10px] font-mono text-slate-light">Loading...</div>
                ) : requirements.length === 0 ? (
                  <div className="text-[10px] font-mono text-slate-light">No requirements logged yet.</div>
                ) : (
                  <div className="space-y-2">
                    {requirements.map(req => (
                      <div
                        key={req.id}
                        className={`flex items-center justify-between p-2.5 border rounded-sm transition-all ${
                          req.is_satisfied
                            ? 'bg-[#D4AF37]/5 border-[#D4AF37]/30'
                            : 'bg-black border-white/5'
                        }`}
                      >
                        <span
                          onClick={() => handleToggleRequirement(req)}
                          className={`text-xs font-sans cursor-pointer flex-1 pr-2 ${req.is_satisfied ? 'text-[#D4AF37] line-through' : 'text-paper'}`}
                        >
                          {req.label}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {req.satisfied_document_id && (
                            <span className="text-[8px] font-mono uppercase tracking-wider text-[#D4AF37] border border-[#D4AF37]/30 px-1 py-0.5 shrink-0">Auto</span>
                          )}
                          <div onClick={() => handleToggleRequirement(req)} className="cursor-pointer">
                            {req.is_satisfied ? (
                              <ToggleRight className="w-6 h-6 text-[#D4AF37]" />
                            ) : (
                              <ToggleLeft className="w-6 h-6 text-slate" />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteRequirement(req)}
                            className="text-slate hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tender documents */}
              <div className="space-y-3 bg-[#0C0C0C] border border-white/5 p-4 rounded-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="block font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider">Tender Documents</span>
                  <label className={`px-3 py-1.5 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-sm text-[8px] font-mono uppercase text-[#D4AF37] hover:bg-[#D4AF37]/20 transition-colors cursor-pointer ${isUploadingDocument ? 'opacity-40 pointer-events-none' : ''}`}>
                    {isUploadingDocument ? 'Uploading...' : 'Upload'}
                    <input
                      type="file"
                      className="hidden"
                      disabled={isUploadingDocument}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadTenderDocument(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                {isLoadingDocuments ? (
                  <div className="text-[10px] font-mono text-slate-light">Loading...</div>
                ) : tenderDocuments.length === 0 ? (
                  <div className="text-[10px] font-mono text-slate-light">No documents uploaded yet.</div>
                ) : (
                  <div className="space-y-2">
                    {tenderDocuments.map(doc => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-2 p-2.5 border border-white/5 bg-black rounded-sm hover:border-[#D4AF37]/30 transition-all"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                        <span className="flex-1 text-xs text-paper truncate">{doc.title || doc.file_name}</span>
                        {isPreviewableFile(doc.file_name) && (
                          <button
                            type="button"
                            onClick={() => void handlePreviewTenderDocument(doc)}
                            title="Preview"
                            className="shrink-0 text-slate-light hover:text-paper"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDownloadTenderDocument(doc.id)}
                          title="Download"
                          className="shrink-0 text-slate-light hover:text-paper"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Assignment */}
              <div className="space-y-3 bg-[#0C0C0C] border border-white/5 p-4 rounded-sm">
                <span className="block font-mono text-[9px] text-[#D4AF37] uppercase tracking-wider">Assigned To</span>
                <AssignmentPanel entityType="tender" entityId={selectedTender.id} />
              </div>

              {/* Bid timing panel */}
              {selectedTenderTimingStatus && (selectedTender.submission_deadline || isPostSubmissionStage(selectedTender.stage)) && (
                <div className="bg-[#111111] border border-white/5 p-4 rounded-sm font-mono text-xs flex justify-between items-center">
                  <div className="flex items-center space-x-2 text-slate-light">
                    <Clock className="w-4 h-4 text-[#3B82F6]" />
                    <span>{isPostSubmissionStage(selectedTender.stage) ? 'Bid status:' : 'Countdown metric:'}</span>
                  </div>
                  <span className={`font-bold tracking-widest ${
                    selectedTenderTimingStatus.urgency === 'critical' ? 'text-red-500 animate-pulse' :
                    selectedTenderTimingStatus.urgency === 'submitted' ? 'text-emerald-300' : 'text-[#3B82F6]'
                  }`}>
                    {selectedTenderTimingStatus.text.toUpperCase()}
                  </span>
                </div>
              )}

            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate">
            <span className="font-mono text-xs uppercase">Telemetry not loaded.</span>
          </div>
        )}
      </div>

      {/* DELETE TENDER MODAL */}
      {isAwardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsAwardModalOpen(false)} />
          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-md rounded-sm p-6 shadow-2xl z-10">
            <h3 className="font-mono text-sm text-emerald-400 uppercase font-bold tracking-wider mb-2">Award Tender</h3>
            <p className="text-xs text-slate-light mb-4">
              Creates the AEGIS project for this contract and seeds its execution budget from any linked quotation. The project starts pending a deposit confirmation before it goes financially live.
            </p>
            <div className="space-y-4 text-xs">
              {awardDepartmentOptions.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Delivered by</label>
                    <select
                      value={selectedAwardDepartmentId}
                      onChange={(e) => setSelectedAwardDepartmentId(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                    >
                      <option value="">Unassigned</option>
                      {awardDepartmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate mb-1 font-mono uppercase text-[9px]">Sourced by</label>
                    <select
                      value={selectedAwardOriginatingDepartmentId}
                      onChange={(e) => setSelectedAwardOriginatingDepartmentId(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-sm p-2 text-white outline-none"
                    >
                      <option value="">Unassigned</option>
                      {awardDepartmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setIsAwardModalOpen(false)} className="px-3 py-1.5 border border-white/5 text-slate-light hover:text-white font-mono text-[10px] uppercase">Cancel</button>
                <button onClick={handleConfirmAward} disabled={isAwarding} className="px-3 py-1.5 bg-emerald-600 text-white font-mono text-[10px] uppercase font-bold disabled:opacity-40">
                  {isAwarding ? 'Awarding...' : 'Confirm Award & Release Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isDeleteTenderModalOpen && selectedTender && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setIsDeleteTenderModalOpen(false)} />
          <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-md rounded-sm p-6 shadow-2xl z-10">
            <h3 className="font-mono text-sm text-rose-400 uppercase font-bold tracking-wider mb-2">Delete Tender</h3>
            <p className="text-xs text-slate-light mb-4">
              This permanently removes <span className="text-paper font-semibold">{selectedTender.tender_name}</span> from the tender pipeline. This cannot be undone from this screen.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setIsDeleteTenderModalOpen(false)} className="px-3 py-1.5 border border-white/5 text-slate-light hover:text-white font-mono text-[10px] uppercase">Cancel</button>
              <button onClick={handleDeleteTender} disabled={isDeletingTender} className="px-3 py-1.5 bg-rose-600 text-white font-mono text-[10px] uppercase font-bold disabled:opacity-40">
                {isDeletingTender ? 'Deleting...' : 'Delete Tender'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewDoc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewDoc(null)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col bg-[#0A0A0A] border border-white/10" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-white/5 p-3">
              <p className="truncate text-sm text-paper">{previewDoc.title}</p>
              <button onClick={() => setPreviewDoc(null)} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
            </header>
            <div className="flex-1 overflow-auto bg-black/40 p-2">
              {previewDoc.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewDoc.url} alt={previewDoc.title} className="mx-auto max-h-[75vh] w-auto" />
              ) : (
                <iframe src={previewDoc.url} title={previewDoc.title} className="h-[75vh] w-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
