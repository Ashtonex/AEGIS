"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TenderInterestSchema } from "@/lib/validations";
import { submitTenderInterest } from "@/lib/api";
import { TenderInterestPayload } from "@/types/api";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { TenderSubmissionUploader, VerifiedDocument } from "./TenderSubmissionUploader";

interface TenderInterestFormProps {
  tenderId: string;
  className?: string;
}

export function TenderInterestForm({ tenderId, className }: TenderInterestFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [attachedDocs, setAttachedDocs] = useState<VerifiedDocument[]>([]);
  const [receiptCode, setReceiptCode] = useState<string>("");
  const [submissionTime, setSubmissionTime] = useState<string>("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TenderInterestPayload>({
    resolver: zodResolver(TenderInterestSchema),
  });

  const onSubmit = async (data: TenderInterestPayload) => {
    setStatus("submitting");
    try {
      await submitTenderInterest(tenderId, data);
      const generatedReceipt = `SNC-BID-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      setReceiptCode(generatedReceipt);
      setSubmissionTime(new Date().toUTCString());
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to register interest.");
    }
  };

  if (status === "success") {
    return (
      <div className={cn("p-8 text-center bg-ink border border-ink-mid rounded-[4px]", className)}>
        <CheckCircle2 className="w-12 h-12 text-[#2ECC71] mx-auto mb-4" />
        <span className="text-signal font-mono text-[11px] uppercase tracking-wider">Interest Receipt Issued</span>
        <h3 className="text-xl font-bold text-paper mt-1 mb-2">Tender Interest Registered</h3>
        <p className="text-[13px] text-slate leading-relaxed max-w-md mx-auto mb-6">
          Your expression of interest has been received. Procurement will confirm the formal submission channel and any required statutory documents.
        </p>

        {/* Verification Receipt Card */}
        <div className="bg-ink-mid/70 border border-ink-mid p-4 rounded text-left font-mono text-[12px] space-y-2 mb-6 max-w-md mx-auto">
          <div className="flex justify-between border-b border-ink-mid/60 pb-2">
            <span className="text-slate uppercase">Tracking Code:</span>
            <span className="text-signal font-bold">{receiptCode}</span>
          </div>
          <div className="flex justify-between border-b border-ink-mid/60 pb-2">
            <span className="text-slate uppercase">Timestamp:</span>
            <span className="text-paper">{submissionTime}</span>
          </div>
          <div className="flex justify-between border-b border-ink-mid/60 pb-2">
            <span className="text-slate uppercase">Documents Prepared:</span>
            <span className="text-[#2ECC71] font-bold">{attachedDocs.length} Local Checks</span>
          </div>
          {attachedDocs.length > 0 && (
            <div className="pt-1 space-y-1">
              {attachedDocs.map((d, i) => (
                <div key={i} className="flex justify-between text-[11px] text-slate truncate">
                  <span className="truncate max-w-[240px]">{d.fileName}</span>
                  <span className="text-slate/60">Local #{d.sha256Hash}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 text-[11px] text-slate font-mono">
          <ShieldCheck className="w-4 h-4 text-signal" />
          <span>Document checks shown here are local readiness checks, not a formal bid acceptance or document upload receipt.</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("space-y-6", className)}>
      {status === "error" && (
        <div className="p-4 rounded border border-red-500/40 bg-red-500/10 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 font-mono">{errorMessage}</p>
        </div>
      )}

      {/* Bidding Entity Credentials */}
      <div className="space-y-4">
        <div className="border-b border-ink-mid pb-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-signal">Section 01</span>
          <h4 className="font-semibold text-[15px] text-paper">Bidder Organization & Contact Information</h4>
        </div>

        <FormField label="Company Legal Name" {...register("companyName")} error={errors.companyName?.message} />
        <FormField label="Authorized Contact Person" {...register("contactPerson")} error={errors.contactPerson?.message} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Corporate Email" type="email" {...register("email")} error={errors.email?.message} />
          <FormField label="Direct Telephone / Mobile" type="tel" {...register("phone")} error={errors.phone?.message} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Company Registration Number" {...register("registrationNumber")} error={errors.registrationNumber?.message} />
          <FormField label="PRAZ Registration Number" {...register("prazNumber")} error={errors.prazNumber?.message} />
        </div>
      </div>

      {/* Section 02: Statutory Enclosures */}
      <div className="space-y-4 pt-2">
        <div className="border-b border-ink-mid pb-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-signal">Section 02</span>
          <h4 className="font-semibold text-[15px] text-paper">Statutory Document Readiness</h4>
        </div>

        <TenderSubmissionUploader
          onDocumentsChange={(docs) => setAttachedDocs(docs)}
          disabled={status === "submitting"}
        />
      </div>

      <div className="pt-2">
        <Button type="submit" className="w-full py-3.5 bg-signal text-ink font-bold tracking-wider uppercase" disabled={status === "submitting"}>
          {status === "submitting" ? "Registering Interest..." : "Register Tender Interest"}
        </Button>
      </div>
    </form>
  );
}
