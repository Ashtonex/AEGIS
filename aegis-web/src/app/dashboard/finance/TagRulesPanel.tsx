"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Eye, Loader2, Pencil, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import {
  applyBankTagRules,
  createBankTagRule,
  deleteBankTagRule,
  getBankTagRules,
  getBankTagRuleSuggestions,
  previewBankTagRules,
  previewDraftBankTagRule,
  updateBankTagRule,
  type BankTagRule,
} from "@/lib/api";
import { CATEGORIES, categoryLabel } from "./BankStatementReviewPanel";

type RecordData = Record<string, any>;

const inputClass = "w-full bg-ink border border-ink-mid rounded px-3 py-2 text-sm text-paper focus:outline-none focus:border-signal/50";
const buttonClass = "inline-flex items-center justify-center gap-2 bg-signal text-ink font-semibold px-3 py-2 rounded-sm text-sm hover:bg-signal/95 disabled:opacity-50";
const ghostClass = "inline-flex items-center justify-center gap-2 border border-ink-mid text-paper px-3 py-2 rounded-sm text-sm hover:border-signal/50 disabled:opacity-50";
const cardClass = "bg-ink-light border border-ink-mid rounded-lg";

function money(value: unknown) {
  const num = Number(value);
  return new Intl.NumberFormat("en-ZW", { style: "currency", currency: "USD" }).format(Number.isFinite(num) ? num : 0);
}

const EMPTY_RULE: BankTagRule = { name: "", match_text: "", direction: "any", priority: 100, is_active: true };

function describeWhen(r: RecordData) {
  const parts = [`contains "${r.match_text}"`];
  if (r.direction === "in") parts.push("money in");
  if (r.direction === "out") parts.push("money out");
  if (r.amount_min != null || r.amount_max != null) parts.push(`${r.amount_min != null ? money(r.amount_min) : "any"} - ${r.amount_max != null ? money(r.amount_max) : "any"}`);
  if (r.date_from || r.date_to) parts.push(`${r.date_from || "..."} to ${r.date_to || "..."}`);
  return parts.join(" · ");
}

function describeSets(r: RecordData, projects: RecordData[]) {
  const projectName = r.project_name || projects.find((p) => p.id === r.set_project_id)?.name;
  return [
    r.set_category && categoryLabel(r.set_category),
    projectName && `project ${projectName}`,
    r.set_counterparty && `who: ${r.set_counterparty}`,
    r.set_note && `note: ${r.set_note}`,
  ].filter(Boolean).join(" · ");
}

/**
 * Auto-tagging rules for bank statement lines: "if the description contains
 * X then set category / project / who / note". Rules only fill empty fields
 * (never overwrite someone's tag), run in priority order, apply to newly
 * imported statements automatically, and always show a preview first.
 */
export function TagRulesPanel({ projects, onApplied }: { projects: RecordData[]; onApplied: () => Promise<unknown> | void }) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<RecordData[]>([]);
  const [suggestions, setSuggestions] = useState<RecordData[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [editing, setEditing] = useState<BankTagRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const loadRules = useCallback(async () => {
    try {
      const res = await getBankTagRules();
      setRules(res.data || []);
    } catch {
      setRules([]);
    }
  }, []);
  useEffect(() => { void loadRules(); }, [loadRules]);

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const res = await getBankTagRuleSuggestions();
      setSuggestions(res.data || []);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Could not load suggestions." });
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice({ tone: "ok", text: message });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const applyAll = () => run(async () => {
    const preview = (await previewBankTagRules()).data;
    if (!preview?.lines_to_tag) return "Nothing to tag - no active rule matches a line with empty tags.";
    const ok = window.confirm(
      `Active rules would tag ${preview.lines_to_tag} line(s) (${money(preview.money_in)} in, ${money(preview.money_out)} out).\n\n` +
      "They only fill empty fields - nothing someone tagged is changed. Claims, costs and the ledger update too.\n\nApply now?",
    );
    if (!ok) return;
    const res = await applyBankTagRules();
    await onApplied();
    await loadRules();
    return `${res.data?.lines_tagged ?? 0} line(s) tagged by rules.`;
  });

  const addSuggestion = (s: RecordData) => run(async () => {
    await createBankTagRule({
      name: s.name, match_text: s.match_text, direction: s.direction, set_category: s.set_category || null,
      set_project_id: s.set_project_id || null, set_counterparty: s.set_counterparty || null,
      date_from: s.date_from || null, date_to: s.date_to || null, priority: s.priority ?? 100, is_active: true,
    });
    setSuggestions((prev) => (prev || []).filter((x) => x !== s));
    await loadRules();
    return `Rule "${s.name}" added.${s.would_tag_now ? " Use Preview & apply to tag the lines it matches now." : " It will tag matching lines in future statements."}`;
  });

  const toggle = (r: RecordData) => run(async () => {
    await updateBankTagRule(r.id, { is_active: !r.is_active });
    await loadRules();
  });

  const remove = (r: RecordData) => run(async () => {
    if (!window.confirm(`Delete the rule "${r.name}"? Lines it already tagged keep their tags.`)) return;
    await deleteBankTagRule(r.id);
    await loadRules();
    return "Rule deleted.";
  });

  return (
    <div className={`${cardClass} p-4 space-y-3`}>
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <Wand2 className="h-6 w-6 text-signal shrink-0" />
        <button className="flex-1 min-w-0 text-left" onClick={() => setOpen((v) => !v)}>
          <p className="text-paper font-semibold flex items-center gap-2">
            Auto-tagging rules <span className="text-xs font-mono text-slate">{rules.filter((r) => r.is_active).length} active</span>
            {open ? <ChevronUp className="h-4 w-4 text-slate" /> : <ChevronDown className="h-4 w-4 text-slate" />}
          </p>
          <p className="text-xs text-slate">
            &ldquo;If the description contains &hellip; then set category / project / who.&rdquo; Rules only fill empty fields, never overwrite
            a tag, and run automatically on every new statement upload.
          </p>
        </button>
        <div className="flex gap-2 shrink-0">
          <button className={ghostClass} onClick={() => { setOpen(true); setEditing({ ...EMPTY_RULE }); }}><Plus className="h-4 w-4" />New rule</button>
          <button className={buttonClass} disabled={busy} onClick={() => void applyAll()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Preview &amp; apply
          </button>
        </div>
      </div>

      {notice && (
        <div className={`border px-3 py-2 text-sm flex justify-between items-center ${notice.tone === "ok" ? "border-signal/30 bg-signal/10 text-paper" : "border-red-500/30 bg-red-950/20 text-red-200"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-slate hover:text-paper"><X className="h-4 w-4" /></button>
        </div>
      )}

      {open && (
        <div className="space-y-4 border-t border-ink-mid pt-3">
          {rules.length === 0 ? (
            <p className="text-sm text-slate">No rules yet. Start from the suggestions below - they&apos;re learned from how the statement has already been tagged.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-mid text-slate uppercase font-mono text-[10px] tracking-wider">
                    <th className="p-2">Rule</th><th className="p-2">When</th><th className="p-2">Sets</th>
                    <th className="p-2 text-right">Priority</th><th className="p-2 text-right">Lines tagged</th><th className="p-2">Active</th><th className="p-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-mid">
                  {rules.map((r) => (
                    <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                      <td className="p-2 text-paper">{r.name}</td>
                      <td className="p-2 text-slate-light">{describeWhen(r)}</td>
                      <td className="p-2 text-slate-light">{describeSets(r, projects)}</td>
                      <td className="p-2 text-right font-mono text-slate-light">{r.priority}</td>
                      <td className="p-2 text-right font-mono text-paper">{Number(r.lines_tagged || 0).toLocaleString()}</td>
                      <td className="p-2"><input type="checkbox" checked={!!r.is_active} onChange={() => void toggle(r)} aria-label="Active" /></td>
                      <td className="p-2 text-right whitespace-nowrap space-x-2">
                        <button className="text-slate hover:text-signal" onClick={() => setEditing({ ...r } as BankTagRule)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                        <button className="text-slate hover:text-red-300" onClick={() => void remove(r)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            {suggestions === null ? (
              <button className={ghostClass} disabled={loadingSuggestions} onClick={() => void loadSuggestions()}>
                {loadingSuggestions ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Suggest rules from my tags
              </button>
            ) : suggestions.length === 0 ? (
              <p className="text-sm text-slate">No more suggestions - every pattern found already has a rule.</p>
            ) : (
              <div>
                <p className="text-[10px] uppercase font-mono tracking-widest text-slate mb-2">Suggested rules</p>
                <ul className="space-y-2">
                  {suggestions.map((s, i) => (
                    <li key={`${s.match_text}-${i}`} className="bg-ink border border-ink-mid rounded p-3 flex flex-col md:flex-row md:items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-paper">{s.name}{s.standard && <span className="ml-2 text-[10px] font-mono uppercase text-slate">standard</span>}</p>
                        <p className="text-xs text-slate">When {describeWhen(s)} → {describeSets(s, projects) || "-"}</p>
                        <p className="text-[11px] text-slate">
                          Matches how {s.supported_by} line(s) are already tagged
                          {s.would_tag_now ? ` · would tag ${s.would_tag_now} untagged line(s) now` : " · for future statements"}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button className={ghostClass} onClick={() => setEditing({ ...s, is_active: true } as BankTagRule)}>Adjust</button>
                        <button className={buttonClass} disabled={busy} onClick={() => void addSuggestion(s)}><Plus className="h-4 w-4" />Add</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <RuleEditor
          rule={editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSaved={async (message) => { setEditing(null); setSuggestions((prev) => prev); await loadRules(); setNotice({ tone: "ok", text: message }); }}
        />
      )}
    </div>
  );
}

function RuleEditor({ rule, projects, onClose, onSaved }: {
  rule: BankTagRule;
  projects: RecordData[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<BankTagRule>(rule);
  const [preview, setPreview] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<BankTagRule>) => { setForm((f) => ({ ...f, ...patch })); setPreview(null); };

  const payload = (): BankTagRule => ({
    name: form.name || form.match_text,
    match_text: form.match_text,
    direction: form.direction || "any",
    amount_min: form.amount_min === null || form.amount_min === undefined || (form.amount_min as unknown) === "" ? null : Number(form.amount_min),
    amount_max: form.amount_max === null || form.amount_max === undefined || (form.amount_max as unknown) === "" ? null : Number(form.amount_max),
    date_from: form.date_from || null,
    date_to: form.date_to || null,
    set_category: form.set_category || null,
    set_project_id: form.set_project_id || null,
    set_counterparty: form.set_counterparty || null,
    set_note: form.set_note || null,
    priority: Number(form.priority ?? 100),
    is_active: form.is_active ?? true,
  });

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview((await previewDraftBankTagRule(payload())).data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (form.id) await updateBankTagRule(form.id, payload());
      else await createBankTagRule(payload());
      await onSaved(form.id ? "Rule updated." : "Rule added. Use Preview & apply to tag lines it matches now; new statements are tagged automatically.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-3" role="dialog" aria-modal="true">
      <form onSubmit={save} className="bg-ink-light border border-ink-mid rounded-lg w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-ink-mid flex justify-between">
          <p className="text-paper font-semibold">{form.id ? "Edit rule" : "New rule"}</p>
          <button type="button" onClick={onClose} className="text-slate hover:text-paper"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate mb-2">When the bank line&hellip;</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className={`${inputClass} md:col-span-2`} required minLength={3} placeholder="Description contains... (e.g. GOLD COAST PROPERTIES)"
                value={form.match_text} onChange={(e) => set({ match_text: e.target.value })} />
              <select className={inputClass} value={form.direction} onChange={(e) => set({ direction: e.target.value as BankTagRule["direction"] })}>
                <option value="any">Money in or out</option><option value="in">Money in only</option><option value="out">Money out only</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} type="number" min="0" step="0.01" placeholder="Min amount" value={form.amount_min ?? ""} onChange={(e) => set({ amount_min: e.target.value === "" ? null : Number(e.target.value) })} />
                <input className={inputClass} type="number" min="0" step="0.01" placeholder="Max amount" value={form.amount_max ?? ""} onChange={(e) => set({ amount_max: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <label className="text-xs text-slate">From date<input className={inputClass} type="date" value={form.date_from ?? ""} onChange={(e) => set({ date_from: e.target.value || null })} /></label>
              <label className="text-xs text-slate">To date<input className={inputClass} type="date" value={form.date_to ?? ""} onChange={(e) => set({ date_to: e.target.value || null })} /></label>
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate mb-2">&hellip;then set (only where still empty)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select className={inputClass} value={form.set_category ?? ""} onChange={(e) => set({ set_category: e.target.value || null })}>
                <option value="">Category: don&apos;t set</option>
                {CATEGORIES.filter((c) => c.value !== "site_petty_cash").map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <select className={inputClass} value={form.set_project_id ?? ""} onChange={(e) => set({ set_project_id: e.target.value || null })}>
                <option value="">Project: don&apos;t set</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className={inputClass} placeholder="Who (payer / payee)" value={form.set_counterparty ?? ""} onChange={(e) => set({ set_counterparty: e.target.value || null })} />
              <input className={inputClass} placeholder="Note" value={form.set_note ?? ""} onChange={(e) => set({ set_note: e.target.value || null })} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className={`${inputClass} md:col-span-2`} placeholder="Rule name (optional)" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            <label className="text-xs text-slate flex items-center gap-2">Priority
              <input className={inputClass} type="number" min="0" value={form.priority ?? 100} onChange={(e) => set({ priority: Number(e.target.value) })} title="Lower runs first" />
            </label>
          </div>

          {preview && (
            <div className="bg-ink border border-ink-mid rounded p-3 text-sm space-y-2">
              <p className="text-paper">
                Matches {preview.lines_matched} line(s): would tag <span className="text-signal font-semibold">{preview.lines_to_tag}</span> now
                ({money(preview.money_in)} in, {money(preview.money_out)} out); {preview.already_tagged} already tagged (left alone).
              </p>
              {preview.sample?.length > 0 && (
                <ul className="text-xs text-slate space-y-0.5 max-h-40 overflow-y-auto">
                  {preview.sample.map((s: RecordData) => (
                    <li key={s.line_id}>{s.transaction_date} · {money(Math.abs(Number(s.amount)))} · {s.description}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-ink-mid flex justify-end gap-2">
          <button type="button" className={ghostClass} disabled={busy || form.match_text.trim().length < 3} onClick={() => void doPreview()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Preview
          </button>
          <button type="submit" className={buttonClass} disabled={busy}>Save rule</button>
        </div>
      </form>
    </div>
  );
}
