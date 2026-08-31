"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Calculator, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "../ui/Button";
import { submitEnquiry } from "@/lib/api";
import { PROVINCES } from "@/lib/constants";

const FLEET_CLASSES = [
  "Excavation and bulk earthworks",
  "Dozing and ripping",
  "Grading and road formation",
  "Haulage and material movement",
  "Compaction",
  "Lifting and cranage",
];

export function PlantHireCalculator() {
  const [fleetClass, setFleetClass] = useState(FLEET_CLASSES[0]);
  const [destinationProvince, setDestinationProvince] = useState("Harare");
  const [durationDays, setDurationDays] = useState(14);
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await submitEnquiry({
        fullName,
        company,
        jobTitle: "Plant Fleet Hire Request",
        email,
        phone,
        type: "Plant Hire",
        province: destinationProvince,
        message: [
          "[PLANT HIRE AVAILABILITY REQUEST]",
          `Fleet class: ${fleetClass}`,
          `Deployment province: ${destinationProvince}`,
          `Indicative duration: ${durationDays} days`,
          "Commercial terms: formal quotation required",
        ].join("\n"),
      });
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-ink border border-ink-mid rounded-[4px] p-8 text-center text-paper">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-[#2ECC71]" />
        <h3 className="text-[20px] font-bold">Plant Hire Inquiry Received</h3>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate">
          Commercial terms are issued only through a formal quotation after availability, site access, and scope review.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-ink border border-ink-mid rounded-[4px] p-6 md:p-8 text-paper">
      <div className="mb-6 flex flex-col gap-4 border-b border-ink-mid pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-signal">
            <Calculator className="h-4 w-4" />
            Plant Hire Availability Request
          </div>
          <h3 className="text-[24px] font-bold tracking-tight">Request Fleet Mobilization Review</h3>
        </div>
        <div className="flex items-center gap-2 border border-ink-mid bg-ink-light px-3 py-2 font-mono text-[11px] text-slate">
          <ShieldCheck className="h-4 w-4 text-signal" />
          <span>Formal quote required before commitment</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Fleet Class</span>
          <select
            value={fleetClass}
            onChange={(event) => setFleetClass(event.target.value)}
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
          >
            {FLEET_CLASSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Deployment Province</span>
          <select
            value={destinationProvince}
            onChange={(event) => setDestinationProvince(event.target.value)}
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
          >
            {PROVINCES.map((province) => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Indicative Duration</span>
          <input
            type="number"
            min={1}
            max={365}
            value={durationDays}
            onChange={(event) => setDurationDays(Number(event.target.value))}
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Company</span>
          <input
            required
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Contact Name</span>
          <input
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate">Phone</span>
          <input
            required
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="h-10 w-full border border-ink-mid bg-ink-light px-3 text-sm text-paper outline-none focus:border-signal"
          />
        </label>
      </div>

      <Button type="submit" disabled={submitting} className="mt-6 w-full justify-center gap-2">
        {submitting ? "Sending Request..." : "Request Formal Availability Review"}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
