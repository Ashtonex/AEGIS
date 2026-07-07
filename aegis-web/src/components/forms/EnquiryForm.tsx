"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EnquirySchema } from "@/lib/validations";
import { submitEnquiry } from "@/lib/api";
import { EnquiryPayload } from "@/types/api";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { PROVINCES } from "@/lib/constants";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface EnquiryFormProps {
  defaultType?: string;
  className?: string;
}

export function EnquiryForm({ defaultType = "General", className }: EnquiryFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EnquiryPayload>({
    resolver: zodResolver(EnquirySchema),
    defaultValues: {
      type: defaultType,
    },
  });

  const onSubmit = async (data: EnquiryPayload) => {
    setStatus("submitting");
    try {
      await submitEnquiry(data);
      setStatus("success");
      reset();
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to submit enquiry.");
    }
  };

  if (status === "success") {
    return (
      <div className={cn("p-12 text-center border border-[var(--snc-success)]/30 rounded-sm bg-[var(--snc-navy-raised)]", className)}>
        <CheckCircle2 className="w-12 h-12 text-[var(--snc-success)] mx-auto mb-4" />
        <h3 className="text-xl font-bold text-[var(--snc-white)] mb-2">Enquiry Received</h3>
        <p className="text-[var(--snc-mist)] mb-6">Thank you for contacting Six Nine Constructions. Our commercial team will be in touch shortly.</p>
        <Button variant="outline" onClick={() => setStatus("idle")}>Send Another</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("space-y-6", className)}>
      {status === "error" && (
        <div className="p-4 rounded-sm border border-[var(--snc-danger)] bg-[var(--snc-danger)]/10 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--snc-danger)] shrink-0" />
          <p className="text-sm text-[var(--snc-danger)]">{errorMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FormField
          label="Full Name"
          {...register("fullName")}
          error={errors.fullName?.message}
        />
        <FormField
          label="Job Title"
          {...register("jobTitle")}
          error={errors.jobTitle?.message}
        />
        <FormField
          label="Company"
          {...register("company")}
          error={errors.company?.message}
        />
        <FormField
          label="Email Address"
          type="email"
          {...register("email")}
          error={errors.email?.message}
        />
        <FormField
          label="Phone Number"
          type="tel"
          {...register("phone")}
          error={errors.phone?.message}
        />
        <FormField
          label="Province"
          as="select"
          options={PROVINCES.map(p => ({ label: p, value: p }))}
          {...register("province")}
          error={errors.province?.message}
        />
        <FormField
          label="Enquiry Type"
          as="select"
          options={[
            "New Project",
            "Plant Hire",
            "Joint Venture",
            "Supplier",
            "Career",
            "Press",
            "General"
          ].map(t => ({ label: t, value: t }))}
          {...register("type")}
          error={errors.type?.message}
        />
        <FormField
          label="Estimated Budget (Optional)"
          {...register("budget")}
          error={errors.budget?.message}
        />
      </div>

      <FormField
        label="Message"
        as="textarea"
        {...register("message")}
        error={errors.message?.message}
      />

      <Button
        type="submit"
        variant="default"
        disabled={status === "submitting"}
        className="w-full md:w-auto"
      >
        {status === "submitting" ? "Submitting..." : "Submit Enquiry"}
      </Button>
    </form>
  );
}
