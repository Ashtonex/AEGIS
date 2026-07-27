"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { createCrmMessageTemplate, getCrmMessageTemplates } from "@/lib/api";

export default function CrmTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadTemplates() {
    try {
      const response = await getCrmMessageTemplates();
      setTemplates(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch {
      setTemplates([]);
      setError("Message templates could not be loaded from the CRM service.");
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, []);

  async function submitTemplate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !body.trim()) return;
    try {
      const response = await createCrmMessageTemplate({
        name: name.trim(),
        channel,
        subject: subject.trim() || null,
        body: body.trim(),
        variables: [],
      });
      if (!response?.data?.id) throw new Error("CRM template response did not include an id.");
      setName("");
      setSubject("");
      setBody("");
      await loadTemplates();
    } catch {
      setError("Message template was not created. Check the CRM service connection and retry.");
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
            <FileText className="h-5 w-5" />
            <span className="font-mono text-[10px] uppercase tracking-widest">CRM templates</span>
          </div>
          <h1 className="mt-2 text-2xl font-black uppercase">Message Templates</h1>
        </header>
        {error && <div className="border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>}
        <form onSubmit={submitTemplate} className="grid gap-3 border border-ink-mid bg-ink-light p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-signal" />
            <select value={channel} onChange={(event) => setChannel(event.target.value)} className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-signal">
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="portal_message">Portal Message</option>
            </select>
          </div>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-signal" />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Template body" rows={4} className="border border-ink-mid bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-signal" />
          <button className="inline-flex w-fit items-center justify-center gap-2 bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-black">
            <Plus className="h-4 w-4" />
            Create
          </button>
        </form>
        <section className="grid gap-3">
          {templates.length === 0 ? (
            <div className="border border-ink-mid bg-ink-light p-8 text-center font-mono text-xs uppercase text-slate">No production message templates recorded.</div>
          ) : (
            templates.map((template) => (
              <article key={template.id} className="border border-ink-mid bg-ink-light p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-bold text-paper">{template.name}</h2>
                  <span className="font-mono text-[10px] uppercase text-slate">{template.channel}</span>
                </div>
                <p className="mt-2 text-sm text-slate-light">{template.subject || "No subject"}</p>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
