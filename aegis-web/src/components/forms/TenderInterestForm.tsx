"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TenderInterestSchema } from "@/lib/validations";
import { submitTenderInterest } from "@/lib/api";
import { TenderInterestPayload } from "@/types/api";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TenderInterestFormProps {
  tenderId: string;
  className?: string;
}

export function TenderInterestForm({ tenderId, className }: TenderInterestFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

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
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to register interest.");
    }
  };

  if (status === "success") {
    return (
      <div className={cn("p-8 text-center", className)}>
        <CheckCircle2 className="w-12 h-12 text-[var(--snc-success)] mx-auto mb-4" />
        <h3 className="text-xl font-bold text-[var(--snc-white)] mb-2">Interest Registered</h3>
        <p className="text-[var(--snc-mist)]">We will contact you with further instructions and updates regarding this tender.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("space-y-4", className)}>
      {status === "error" && (
        <div className="p-4 rounded-sm border border-[var(--snc-danger)] bg-[var(--snc-danger)]/10 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--snc-danger)] shrink-0" />
          <p className="text-sm text-[var(--snc-danger)]">{errorMessage}</p>
        </div>
      )}

      <FormField label="Company Name" {...register("companyName")} error={errors.companyName?.message} />
      <FormField label="Contact Person" {...register("contactPerson")} error={errors.contactPerson?.message} />
      
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Email" type="email" {...register("email")} error={errors.email?.message} />
        <FormField label="Phone" type="tel" {...register("phone")} error={errors.phone?.message} />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Company Registration No." {...register("registrationNumber")} error={errors.registrationNumber?.message} />
        <FormField label="PRAZ Number (Optional)" {...register("prazNumber")} error={errors.prazNumber?.message} />
      </div>

      <div className="pt-4">
        <Button type="submit" className="w-full" disabled={status === "submitting"}>
          {status === "submitting" ? "Registering..." : "Confirm Interest"}
        </Button>
      </div>
    </form>
  );
}
