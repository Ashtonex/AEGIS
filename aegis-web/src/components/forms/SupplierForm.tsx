"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SupplierRegistrationSchema } from "@/lib/validations";
import { registerSupplier } from "@/lib/api";
import { SupplierRegistrationPayload } from "@/types/api";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { PROVINCES } from "@/lib/constants";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SupplierFormProps {
  className?: string;
}

export function SupplierForm({ className }: SupplierFormProps) {
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<SupplierRegistrationPayload>({
    resolver: zodResolver(SupplierRegistrationSchema),
    defaultValues: {
      categories: ["Construction Materials"],
      provinces: ["Harare"],
      documents: {
        profileUrl: "pending",
        taxClearanceUrl: "pending",
        incorporationUrl: "pending"
      }
    }
  });

  const nextStep = async () => {
    let fieldsToValidate: any[] = [];
    if (step === 1) fieldsToValidate = ["companyName", "registrationNumber", "taxClearanceNumber", "prazNumber", "yearEstablished", "employees", "address", "contactPerson", "email", "phone", "website"];
    if (step === 2) fieldsToValidate = ["categories", "description", "provinces", "references"];
    
    const isStepValid = await trigger(fieldsToValidate as any);
    if (isStepValid) setStep(step + 1);
  };

  const onSubmit = async (data: SupplierRegistrationPayload) => {
    setStatus("submitting");
    try {
      await registerSupplier(data);
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to submit registration.");
    }
  };

  if (status === "success") {
    return (
      <div className={cn("p-12 text-center border border-[var(--snc-success)]/30 rounded-sm bg-[var(--snc-navy-raised)]", className)}>
        <CheckCircle2 className="w-16 h-16 text-[var(--snc-success)] mx-auto mb-6" />
        <h3 className="text-2xl font-bold text-[var(--snc-white)] mb-4">Registration Submitted</h3>
        <p className="text-[var(--snc-mist)] mb-8 max-w-lg mx-auto">Your supplier application has been received. Our procurement team will review your credentials and you will be notified of the outcome.</p>
        <div className="p-4 bg-[#050A14] inline-block rounded-sm border border-[var(--snc-navy-border)]">
          <p className="text-xs text-[var(--snc-grey)] uppercase tracking-widest mb-1">Application Reference</p>
          <p className="font-mono text-[var(--snc-gold)] text-lg">SUP-{Math.floor(1000 + Math.random() * 9000)}-2025</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn("space-y-8", className)}>
      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex-1 h-1 rounded-full overflow-hidden bg-[var(--snc-navy-border)] relative">
             <div className={cn("absolute inset-y-0 left-0 bg-[var(--snc-gold)] transition-all duration-300", s <= step ? "w-full" : "w-0")} />
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
        <div className="space-y-6 animate-in fade-in">
          <div>
            <h3 className="text-xl font-bold text-[var(--snc-white)] mb-1">Company Information</h3>
            <p className="text-sm text-[var(--snc-mist)]">Step 1 of 3: Provide your legal entity details.</p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            <FormField label="Legal Company Name" {...register("companyName")} error={errors.companyName?.message} />
            <FormField label="Registration Number" {...register("registrationNumber")} error={errors.registrationNumber?.message} />
            <FormField label="Tax Clearance Number" {...register("taxClearanceNumber")} error={errors.taxClearanceNumber?.message} />
            <FormField label="PRAZ Number (Optional)" {...register("prazNumber")} error={errors.prazNumber?.message} />
            <FormField label="Year Established" type="number" {...register("yearEstablished", { valueAsNumber: true })} error={errors.yearEstablished?.message} />
            <FormField label="Number of Employees" type="number" {...register("employees", { valueAsNumber: true })} error={errors.employees?.message} />
          </div>

          <div className="border-t border-[var(--snc-navy-border)] pt-6 grid md:grid-cols-2 gap-6">
            <FormField label="Primary Contact Person" {...register("contactPerson")} error={errors.contactPerson?.message} />
            <FormField label="Email Address" type="email" {...register("email")} error={errors.email?.message} />
            <FormField label="Phone Number" type="tel" {...register("phone")} error={errors.phone?.message} />
            <FormField label="Website (Optional)" {...register("website")} error={errors.website?.message} />
            <div className="md:col-span-2">
              <FormField label="Registered Physical Address" as="textarea" {...register("address")} error={errors.address?.message} />
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button type="button" onClick={nextStep}>Next Step</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
          <div>
            <h3 className="text-xl font-bold text-[var(--snc-white)] mb-1">Capability & Coverage</h3>
            <p className="text-sm text-[var(--snc-mist)]">Step 2 of 3: What do you supply and where.</p>
          </div>
          
          <div className="space-y-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--snc-mist)]">Category of Supply</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                "Construction Materials", "Plant & Equipment", "Engineering Services",
                "Professional Services", "IT & Technology", "Fuel & Lubricants",
                "Safety Equipment", "Labour", "Transport"
              ].map(cat => (
                <div key={cat} className="flex items-center gap-2 bg-[var(--snc-navy-mid)] p-3 rounded-sm border border-[var(--snc-navy-border)]">
                  <input type="checkbox" id={`cat-${cat}`} value={cat} {...register("categories")} className="rounded-sm border-[var(--snc-navy-border)] bg-[var(--snc-navy)] text-[var(--snc-gold)] focus:ring-[var(--snc-gold)]" />
                  <label htmlFor={`cat-${cat}`} className="text-sm text-[var(--snc-white)] cursor-pointer">{cat}</label>
                </div>
              ))}
            </div>
            {errors.categories && <p className="text-[10px] text-[var(--snc-danger)] mt-1 font-medium">{errors.categories.message}</p>}
          </div>

          <FormField label="Detailed Description of Services/Products" as="textarea" {...register("description")} error={errors.description?.message} />

          <div className="space-y-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--snc-mist)]">Geographic Coverage</label>
            <div className="grid grid-cols-2 gap-3">
              {PROVINCES.map(prov => (
                <div key={prov} className="flex items-center gap-2">
                  <input type="checkbox" id={`prov-${prov}`} value={prov} {...register("provinces")} className="rounded-sm border-[var(--snc-navy-border)] bg-[var(--snc-navy)] text-[var(--snc-gold)] focus:ring-[var(--snc-gold)]" />
                  <label htmlFor={`prov-${prov}`} className="text-sm text-[var(--snc-mist)] cursor-pointer">{prov}</label>
                </div>
              ))}
            </div>
            {errors.provinces && <p className="text-[10px] text-[var(--snc-danger)] mt-1 font-medium">{errors.provinces.message}</p>}
          </div>

          <FormField label="Key Clients / References (Provide at least one)" as="textarea" {...register("references")} error={errors.references?.message} />

          <div className="flex justify-between pt-4">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button type="button" onClick={nextStep}>Next Step</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
          <div>
            <h3 className="text-xl font-bold text-[var(--snc-white)] mb-1">Required Documentation</h3>
            <p className="text-sm text-[var(--snc-mist)]">Step 3 of 3: Upload supporting documents.</p>
          </div>

          <div className="space-y-4">
            {[
              { label: "Company Profile", required: true },
              { label: "Tax Clearance Certificate", required: true },
              { label: "Certificate of Incorporation", required: true },
              { label: "PRAZ Certificate", required: false },
              { label: "ISO / Quality Certifications", required: false },
            ].map(doc => (
              <div key={doc.label} className="p-4 border border-[var(--snc-navy-border)] rounded-sm bg-[var(--snc-navy-mid)] flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-[var(--snc-white)]">{doc.label} {doc.required && <span className="text-[var(--snc-danger)]">*</span>}</h4>
                  <p className="text-xs text-[var(--snc-grey)]">PDF format only, max 5MB</p>
                </div>
                <input type="file" className="text-sm text-[var(--snc-mist)] file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-0 file:text-xs file:font-semibold file:bg-[var(--snc-navy)] file:text-[var(--snc-mist)] file:border file:border-[var(--snc-navy-border)] hover:file:bg-[var(--snc-navy-raised)]" />
              </div>
            ))}
          </div>

          <div className="pt-6 space-y-4">
            <div className="flex items-start gap-3">
              <input type="checkbox" id="banking" className="mt-1" required />
              <label htmlFor="banking" className="text-sm text-[var(--snc-mist)]">
                I confirm that the company holds an active corporate bank account in the name of the registered entity.
              </label>
            </div>
            <div className="flex items-start gap-3">
              <input type="checkbox" id="declaration" className="mt-1" required />
              <label htmlFor="declaration" className="text-sm text-[var(--snc-mist)]">
                I declare that the information provided is true and correct, and that I am authorised to complete this registration on behalf of the company.
              </label>
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>Back</Button>
            <Button type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Submitting Registration..." : "Submit Registration"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
