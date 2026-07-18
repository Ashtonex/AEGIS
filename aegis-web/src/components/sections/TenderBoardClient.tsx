"use client";

import { useState, useEffect } from "react";
import { Search, FolderOpen, X } from "lucide-react";
import { Tender } from "@/types/website";
import { TenderCard } from "./TenderCard";
import { FormField } from "../ui/FormField";
import { EmptyState } from "../ui/EmptyState";
import { StaggerContainer, StaggerItem } from "../ui/StaggerContainer";
import { TenderInterestForm } from "../forms/TenderInterestForm";
import { motion, AnimatePresence } from "framer-motion";

interface TenderBoardClientProps {
  initialTenders: Tender[];
}

export function TenderBoardClient({ initialTenders }: TenderBoardClientProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);

  // Close modal on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedTenderId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedTender = initialTenders.find((t) => t.id === selectedTenderId);

  // Filter logic
  const filteredTenders = initialTenders.filter((tender) => {
    const matchesSearch =
      tender.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tender.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tender.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory =
      !categoryFilter || tender.category.toLowerCase() === categoryFilter.toLowerCase();

    const matchesStatus =
      !statusFilter || tender.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <>
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-snc-text-tertiary z-10" />
          <FormField
            className="pl-12 w-full mb-0 bg-snc-navy border-snc-border text-snc-text-primary placeholder:text-snc-text-tertiary focus:border-snc-gold-primary"
            containerClassName="mb-0"
            placeholder="Search tender reference, title, or details..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <FormField
          as="select"
          containerClassName="mb-0 w-full md:w-48"
          className="mb-0 text-snc-text-secondary bg-snc-navy border-snc-border focus:border-snc-gold-primary"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          options={[
            { label: "All Categories", value: "" },
            { label: "Materials", value: "materials" },
            { label: "Plant Hire", value: "plant" },
            { label: "Sub-contracting", value: "subcontract" }
          ]}
        />
        <FormField
          as="select"
          containerClassName="mb-0 w-full md:w-48"
          className="mb-0 text-snc-text-secondary bg-snc-navy border-snc-border focus:border-snc-gold-primary"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={[
            { label: "All Statuses", value: "" },
            { label: "Open", value: "Open" },
            { label: "Closing Soon", value: "Closing Soon" }
          ]}
        />
      </div>

      {/* Tender List */}
      <div className="bg-snc-navy border border-snc-border rounded-[4px] overflow-hidden mb-16">
        <div className="hidden lg:grid grid-cols-12 gap-6 p-4 border-b border-snc-border bg-snc-navy-mid font-sans text-[11px] font-semibold tracking-widest uppercase text-snc-text-tertiary">
          <div className="col-span-2">Reference</div>
          <div className="col-span-4">Title</div>
          <div className="col-span-3">Details</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>

        <div className="flex flex-col">
          {filteredTenders.length > 0 ? (
            <StaggerContainer>
              {filteredTenders.map((tender) => (
                <StaggerItem key={tender.id}>
                  <TenderCard
                    tender={tender}
                    variant="row"
                    className="bg-snc-void"
                    onRegisterInterest={(id) => setSelectedTenderId(id)}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <EmptyState
              icon={FolderOpen}
              title="No Tenders Found"
              description="There are currently no active tenders matching your filters."
            />
          )}
        </div>
      </div>

      {/* Register Interest Modal */}
      <AnimatePresence>
        {selectedTenderId && selectedTender && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTenderId(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />

            {/* Modal Body */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="relative w-full max-w-xl bg-snc-navy border border-snc-gold-primary shadow-2xl p-6 md:p-8 rounded-sm z-10 font-sans text-snc-text-primary"
            >
              {/* Close Button */}
              <button
                onClick={() => setSelectedTenderId(null)}
                className="absolute top-4 right-4 text-snc-text-tertiary hover:text-snc-text-primary transition-colors focus:outline-none"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[11px] font-mono text-snc-gold-primary tracking-wider uppercase border border-snc-gold-primary/30 px-2 py-0.5 rounded-sm">
                    {selectedTender.reference}
                  </span>
                  <span className="text-[11px] font-mono text-snc-text-tertiary uppercase">
                    {selectedTender.category}
                  </span>
                </div>
                <h3 className="text-headline-md text-snc-text-primary mb-2 font-display">
                  Register Bid Interest
                </h3>
                <p className="text-body-sm text-snc-text-secondary">
                  Submit your organization&apos;s core details below to register interest in:{" "}
                  <strong className="text-snc-text-primary">{selectedTender.title}</strong>.
                </p>
              </div>

              <div className="border-t border-snc-border/60 pt-6">
                <TenderInterestForm tenderId={selectedTender.id} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
