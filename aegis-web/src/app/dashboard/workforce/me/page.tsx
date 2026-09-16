"use client";

import { useEffect, useState } from "react";
import { workforceFoundation } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";

type OwnWorker = {
  employee_name: string;
  employee_number: string | null;
  job_title: string | null;
  employment_status: string;
  work_location: string | null;
};

export default function MyWorkforceProfile() {
  const [worker, setWorker] = useState<OwnWorker | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void workforceFoundation<OwnWorker>("me")
      .then(result => { if (active) setWorker(result.data); })
      .catch(reason => {
        if (active) {
          setWorker(null);
          setError(reason instanceof Error ? reason.message : "Your workforce profile could not be loaded.");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <DashboardPageHeader
        className="mb-0 border-b-0 pb-0"
        title="My Workforce Profile"
        subtitle="Your employment details linked to your signed-in account. Contact HR to request a correction."
      />
      {loading && <p role="status">Loading your profile…</p>}
      {error && (
        <div className="space-y-3">
          <p role="alert" className="text-red-400">{error}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 border border-ink-mid px-4 py-2 text-signal">Retry</button>
        </div>
      )}
      {!loading && worker && (
        <dl className="grid gap-4 rounded border border-ink-mid bg-ink-light p-5 sm:grid-cols-2">
          {[
            ["Name", worker.employee_name],
            ["Worker number", worker.employee_number],
            ["Job title", worker.job_title],
            ["Employment status", worker.employment_status],
            ["Work location", worker.work_location],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-slate-light">{label}</dt>
              <dd className="break-words text-paper">{value || "Not recorded"}</dd>
            </div>
          ))}
        </dl>
      )}
    </main>
  );
}
