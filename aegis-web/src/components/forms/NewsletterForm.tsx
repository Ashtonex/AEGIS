"use client";

import { useState } from "react";
import { subscribeNewsletter } from "@/lib/api";
import { Button } from "../ui/Button";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface NewsletterFormProps {
  className?: string;
}

export function NewsletterForm({ className }: NewsletterFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(email.trim())) {
      setStatus("error");
      setErrorMessage("Enter a valid email address.");
      return;
    }

    setStatus("submitting");
    try {
      await subscribeNewsletter(email.trim());
      setStatus("success");
      setEmail("");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err?.message || "Failed to subscribe. Please retry.");
    }
  };

  if (status === "success") {
    return (
      <div className={cn("flex items-center justify-center gap-3 max-w-lg mx-auto text-[var(--dxl-success)]", className)}>
        <CheckCircle2 className="w-5 h-5 shrink-0" />
        <p className="text-sm">Subscribed. Watch your inbox for the next briefing.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={cn("max-w-lg mx-auto", className)}>
      {status === "error" && (
        <div className="mb-4 flex items-center justify-center gap-2 text-sm text-[var(--dxl-danger)]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Corporate Email Address"
          required
          disabled={status === "submitting"}
          className="flex-1 px-4 py-3 bg-[var(--dxl-ink)] border border-[var(--dxl-ink-mid)] rounded-sm text-[var(--dxl-paper)] focus:outline-none focus:border-[var(--dxl-signal)] disabled:opacity-60"
        />
        <Button type="submit" variant="default" disabled={status === "submitting"}>
          {status === "submitting" ? "Subscribing..." : "Subscribe"}
        </Button>
      </div>
    </form>
  );
}
