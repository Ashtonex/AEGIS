"use client";

import React, { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, Upload } from "lucide-react";

// Use a loose but workable props type that avoids the union conflict
// The `as` prop controls which element is rendered; each branch casts accordingly
export interface FormFieldProps {
  label?: string;
  error?: string;
  as?: "input" | "textarea" | "select" | "file";
  options?: { label: string; value: string }[];
  containerClassName?: string;
  className?: string;
  rows?: number;
  placeholder?: string;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  type?: string;
  accept?: string;
  autoComplete?: string;
  readOnly?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  multiple?: boolean;
}

export const FormField = forwardRef<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  FormFieldProps
>(
  (
    {
      label,
      error,
      as = "input",
      options,
      className,
      containerClassName,
      rows,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      "w-full bg-snc-navy-mid border border-snc-border rounded-sm px-4 py-[14px] text-snc-text-primary font-sans text-[15px] transition-colors duration-150 ease-out focus:outline-none focus:border-snc-gold-primary focus:shadow-[0_0_0_3px_rgba(200,150,12,0.08)] placeholder:text-snc-text-disabled";

    const errorClasses =
      "border-snc-danger focus:border-snc-danger focus:shadow-[0_0_0_3px_rgba(239,68,68,0.08)]";

    const fileBaseClasses =
      "w-full bg-transparent border border-dashed border-snc-border rounded-sm p-8 text-center text-snc-text-secondary font-sans text-[15px] transition-all duration-150 hover:border-snc-gold-primary hover:bg-snc-gold-ghost cursor-pointer";

    const resolvedClass = cn(baseClasses, error && errorClasses, className);

    return (
      <div className={cn("flex flex-col mb-4", containerClassName)}>
        {label && (
          <label className="text-label text-[11px] text-snc-gold-primary mb-2 block">
            {label}
          </label>
        )}

        <div className="relative">
          {as === "input" && (
            <input
              ref={ref as React.Ref<HTMLInputElement>}
              className={resolvedClass}
              {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
            />
          )}

          {as === "textarea" && (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              className={resolvedClass}
              rows={rows ?? 4}
              {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          )}

          {as === "select" && (
            <>
              <select
                ref={ref as React.Ref<HTMLSelectElement>}
                className={cn(resolvedClass, "appearance-none cursor-pointer")}
                {...(props as React.SelectHTMLAttributes<HTMLSelectElement>)}
              >
                <option value="" disabled>Select an option...</option>
                {options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-snc-gold-primary">
                <ChevronDown className="w-4 h-4" />
              </div>
            </>
          )}

          {as === "file" && (
            <div className={cn(fileBaseClasses, error && errorClasses, className)}>
              <input
                type="file"
                ref={ref as React.Ref<HTMLInputElement>}
                {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center pointer-events-none">
                <Upload className="w-6 h-6 text-snc-text-tertiary mb-3" />
                <span>{props.placeholder || "Drag and drop or click to upload"}</span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 mt-1.5 text-snc-danger">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="font-sans text-[12px]">{error}</span>
          </div>
        )}
      </div>
    );
  }
);

FormField.displayName = "FormField";
