"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Users } from "lucide-react";
import { createCrmSegment, getCrmSegments } from "@/lib/api";

export default function CrmSegmentsPage() {
  const [segments, setSegments] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadSegments() {
    try {
      const response = await getCrmSegments();
      setSegments(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch {
      setSegments([]);
      setError("Segments could not be loaded from the CRM service.");
    }
  }

  useEffect(() => {
    void loadSegments();
  }, []);

  async function submitSegment(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const response = await createCrmSegment({ name: name.trim(), description: description.trim() || null, criteria: {} });
      if (!response?.data?.id) throw new Error("CRM segment response did not include an id.");
      setName("");
      setDescription("");
      await loadSegments();
    } catch {
      setError("Segment was not created. Check the CRM service connection and retry.");
    }
  }

  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="mx-auto flex max-w-container flex-col gap-5 px-6 py-6">
        <Link href="/dashboard/crm/marketing" className="inline-flex items-center gap-2 text-xs font-mono uppercase text-slate hover:text-signal">
          <ArrowLeft className="h-4 w-4" />
          Back to marketing
        </Link>
        <header className="border-b border-ink-mid pb-4">
          <div className="flex items-center gap-2 text-signal">
            <Users className="h-5 w-5" />
            <span className="font-mono text-[10px] uppercase tracking-widest">CRM segments</span>
          </div>
          <h1 className="mt-2 text-2xl font-black uppercase">Target Segments</h1>
        </header>
        {error && <div className="border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>}
        <form onSubmit={submitSegment} className="grid gap-3 border border-ink-mid bg-ink-light p-4 md:grid-cols-[220px_1fr_auto]">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Segment name" className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-signal" />
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-signal" />
          <button className="inline-flex items-center justify-center gap-2 bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-black">
            <Plus className="h-4 w-4" />
            Create
          </button>
        </form>
        <section className="grid gap-3">
          {segments.length === 0 ? (
            <div className="border border-ink-mid bg-ink-light p-8 text-center font-mono text-xs uppercase text-slate">No production segments recorded.</div>
          ) : (
            segments.map((segment) => (
              <article key={segment.id} className="border border-ink-mid bg-ink-light p-4">
                <h2 className="font-bold text-paper">{segment.name}</h2>
                <p className="mt-1 text-sm text-slate-light">{segment.description || "No description recorded."}</p>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
