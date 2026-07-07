"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { JobApplicationSchema } from "@/lib/validations";
import { submitJobApplication } from "@/lib/api";
import { JobApplicationPayload } from "@/types/api";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { PROVINCES } from "@/lib/constants";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApplicationFormProps {
  positionId?: string;
  positionTitle?: string;
  className?: string;
  onSuccess?: () => void;
}

export function ApplicationForm({ positionId = "speculative", positionTitle = "Speculative Application", className, onSuccess }: ApplicationFormProps) {
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<JobApplicationPayload>({
    resolver: zodResolver(JobApplicationSchema),
    defaultValues: {
      positionId,
      documents: {
        cvUrl: "pending-upload-via-supabase", // Normally this would be handled by a file upload component
        idUrl: "pending-upload-via-supabase"
      }
    },
  });

  const nextStep = async () => {
    let fieldsToValidate: any[] = [];
    if (step === 1) fieldsToValidate = ["fullName", "email", "phone", "idNumber", "province", "nationality"];
    if (step === 2) fieldsToValidate = ["experienceYears", "highestQualification", "institution", "coverNote"];
    
    const isStepValid = await trigger(fieldsToValidate as any);
    if (isStepValid) setStep(step + 1);
  };

  const onSubmit = async (data: JobApplicationPayload) => {
    setStatus("submitting");
    try {
      await submitJobApplication(data);
      setStatus("success");
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to submit application.");
    }
  };

  if (status === "success") {
    return (
      <div className={cn("p-12 text-center", className)}>
        <CheckCircle2 className="w-12 h-12 text-[var(--snc-success)] mx-auto mb-4" />
        <h3 className="text-xl font-bold text-[var(--snc-white)] mb-2">Application Submitted</h3>
        <p className="text-[var(--snc-mist)]">Your application for {positionTitle} has been received. Our HR team will review and be in touch within 5 days.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("space-y-6", className)}>
      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex-1 h-1 rounded-full overflow-hidden bg-[var(--snc-navy-border)]">
            <div className={cn("h-full bg-[var(--snc-gold)] transition-all", s <= step ? "w-full" : "w-0")} />
          </div>
        ))}
      </div>

      {status === "error" && (
        <div className="p-4 rounded-sm border border-[var(--snc-danger)] bg-[var(--snc-danger)]/10 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--snc-danger)] shrink-0" />
          <p className="text-sm text-[var(--snc-danger)]">{errorMessage}</p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 animate-in fade-in">
          <h3 className="text-lg font-bold text-[var(--snc-white)] mb-4">Personal Details</h3>
          <FormField label="Full Name" {...register("fullName")} error={errors.fullName?.message} />
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Email" type="email" {...register("email")} error={errors.email?.message} />
            <FormField label="Phone" type="tel" {...register("phone")} error={errors.phone?.message} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="ID Number" {...register("idNumber")} error={errors.idNumber?.message} />
            <FormField label="Nationality" {...register("nationality")} error={errors.nationality?.message} />
          </div>
          <FormField label="Province" as="select" options={PROVINCES.map(p => ({ label: p, value: p }))} {...register("province")} error={errors.province?.message} />
          
          <div className="flex justify-end pt-4">
            <Button type="button" onClick={nextStep}>Next Step</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
          <h3 className="text-lg font-bold text-[var(--snc-white)] mb-4">Professional Profile</h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Years Experience" type="number" {...register("experienceYears", { valueAsNumber: true })} error={errors.experienceYears?.message} />
            <FormField label="Highest Qualification" {...register("highestQualification")} error={errors.highestQualification?.message} />
          </div>
          <FormField label="Institution" {...register("institution")} error={errors.institution?.message} />
          <FormField label="Cover Note" as="textarea" {...register("coverNote")} error={errors.coverNote?.message} />
          
          <div className="flex justify-between pt-4">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button type="button" onClick={nextStep}>Next Step</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
          <h3 className="text-lg font-bold text-[var(--snc-white)] mb-4">Documents & Declaration</h3>
          <p className="text-sm text-[var(--snc-mist)] mb-4">Upload your CV and ID Document (PDF format only, max 5MB).</p>
          
          <div className="p-6 border border-dashed border-[var(--snc-navy-border)] rounded-sm bg-[var(--snc-navy-mid)]">
            <input type="file" className="block w-full text-sm text-[var(--snc-mist)] file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-0 file:text-sm file:font-semibold file:bg-[var(--snc-gold)] file:text-[var(--snc-navy)] hover:file:bg-[var(--snc-gold-bright)]" />
          </div>

          <div className="flex items-start gap-3 mt-6">
            <input type="checkbox" id="declaration" className="mt-1" required />
            <label htmlFor="declaration" className="text-sm text-[var(--snc-mist)]">
              I declare that the information provided is true and correct. I consent to background checks being conducted.
            </label>
          </div>

          <div className="flex justify-between pt-4">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>Back</Button>
            <Button type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Submitting..." : "Submit Application"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
