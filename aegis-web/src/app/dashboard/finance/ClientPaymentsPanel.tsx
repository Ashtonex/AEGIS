"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Banknote, Loader2, Plus, RefreshCw } from "lucide-react";

import {
  clearFinanceClientPaymentRequest,
  createDocument,
  createFinanceClientPaymentRequest,
  getFinanceClientPaymentRequests,
  getInternalProjects,
} from "@/lib/api";
import { PortalDocumentUpload, type UploadedDocumentResult } from "@/components/portal/PortalDocumentUpload";

type RecordData = Record<string, any>;

function money(amount: unknown, currency: unknown) {
  const num = typeof amount === "number" ? amount : Number(amount);
  return `${currency || "USD"} ${Number.isFinite(num) ? num.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

export function ClientPaymentsPanel() {
  const [requests, setRequests] = useState<RecordData[]>([]);
  const [projects, setProjects] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ project_id: "", title: "", description: "", amount: "", currency: "USD", due_date: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, projRes] = await Promise.allSettled([getFinanceClientPaymentRequests(), getInternalProjects()]);
      if (reqRes.status === "fulfilled") setRequests(reqRes.value.data ?? []);
      if (projRes.status === "fulfilled") setProjects(projRes.value.data ?? []);
    } catch {
      setNotice("Client payment requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRequests = requests.filter((r) => r.status === "sent" || r.status === "viewed");
  const clearedRequests = requests.filter((r) => r.status === "cleared");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.project_id || !form.title.trim() || !form.amount) {
      setNotice("Project, title, and amount are required.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await createFinanceClientPaymentRequest({
        project_id: form.project_id,
        title: form.title,
        description: form.description || undefined,
        amount: Number(form.amount),
        currency: form.currency,
        due_date: form.due_date || undefined,
      });
      setNotice("Payment request sent to the client.");
      setForm({ project_id: "", title: "", description: "", amount: "", currency: "USD", due_date: "" });
      setShowForm(false);
      await load();
    } catch {
      setNotice("Could not create the payment request.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReceiptUpload(result: UploadedDocumentResult, requestId: string) {
    setBusyId(requestId);
    setNotice(null);
    try {
      const doc = await createDocument({
        title: `Receipt - ${result.file_name}`,
        category: "receipt",
        storage_path: result.storage_path,
        file_name: result.file_name,
        mime_type: result.mime_type,
        file_size_bytes: result.size_bytes,
      });
      if (!doc.data?.id) throw new Error("Document registration failed.");
      await clearFinanceClientPaymentRequest(requestId, doc.data.id);
      setNotice("Payment marked as cleared and posted to the cashbook.");
      setClearingId(null);
      await load();
    } catch {
      setNotice("Could not clear this payment request.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Client billing</p>
          <h2 className="mt-1 text-xl font-semibold">Client payment requests</h2>
          <p className="mt-1 text-sm text-slate-light">Payment requests sent to clients, visible in their portal.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowForm((v) => !v)} className="inline-flex h-9 items-center gap-2 bg-signal px-3 font-mono text-xs uppercase tracking-widest text-ink">
            <Plus className="h-4 w-4" /> New request
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 border border-ink-mid px-3 font-mono text-xs uppercase tracking-widest text-paper hover:border-signal disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {notice && <p className="border border-ink-mid bg-ink-light px-3 py-2 text-sm text-paper">{notice}</p>}

      {showForm && (
        <form onSubmit={submit} className="grid gap-3 border border-ink-mid bg-ink-light p-4 md:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Project</span>
            <select value={form.project_id} onChange={(e) => setForm((c) => ({ ...c, project_id: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal">
              <option value="">Select project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Title</span>
            <input value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
          </label>
          <label className="block md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Description</span>
            <textarea rows={2} value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} className="mt-2 w-full resize-none border border-ink-mid bg-ink p-3 text-sm text-paper outline-none focus:border-signal" />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Amount</span>
            <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-light">Due date</span>
            <input type="date" value={form.due_date} onChange={(e) => setForm((c) => ({ ...c, due_date: e.target.value }))} className="mt-2 h-10 w-full border border-ink-mid bg-ink px-3 text-sm text-paper outline-none focus:border-signal" />
          </label>
          <div className="md:col-span-2">
            <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 bg-signal px-4 font-mono text-xs uppercase tracking-widest text-ink disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send to client"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center border border-ink-mid bg-ink-light"><Loader2 className="h-5 w-5 animate-spin text-signal" /></div>
      ) : (
        <>
          <div className="border border-ink-mid bg-ink-light">
            <p className="border-b border-ink-mid px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Outstanding ({openRequests.length})</p>
            {openRequests.length === 0 ? (
              <p className="p-6 text-sm text-slate-light">No outstanding client payment requests.</p>
            ) : (
              <div className="divide-y divide-ink-mid">
                {openRequests.map((req) => (
                  <div key={req.id} className="p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{req.title} <span className="font-mono text-[10px] uppercase text-slate-light">({req.project_name})</span></p>
                        {req.description && <p className="mt-1 text-sm text-slate-light">{req.description}</p>}
                      </div>
                      <span className="shrink-0 font-mono text-lg">{money(req.amount, req.currency)}</span>
                    </div>
                    <div className="mt-3">
                      {clearingId === req.id ? (
                        <div className="max-w-xs">
                          <PortalDocumentUpload label="Attach receipt to clear" onUploaded={(r) => handleReceiptUpload(r, req.id)} disabled={busyId === req.id} />
                        </div>
                      ) : (
                        <button type="button" onClick={() => setClearingId(req.id)} className="inline-flex h-9 items-center gap-2 bg-signal px-3 font-mono text-xs uppercase tracking-widest text-ink">
                          <Banknote className="h-4 w-4" /> Mark cleared
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {clearedRequests.length > 0 && (
            <div className="border border-ink-mid bg-ink-light">
              <p className="border-b border-ink-mid px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-light">Cleared ({clearedRequests.length})</p>
              <div className="divide-y divide-ink-mid">
                {clearedRequests.slice(0, 20).map((req) => (
                  <div key={req.id} className="flex items-center justify-between p-4 text-sm">
                    <p>{req.title} - {req.project_name}</p>
                    <span className="font-mono text-emerald-400">{money(req.amount, req.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
