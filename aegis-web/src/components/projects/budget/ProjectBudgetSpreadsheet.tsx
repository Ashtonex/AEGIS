"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus,
  Trash2,
  Save,
  Download,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Copy,
  Layers,
  DollarSign,
  TrendingUp,
  Percent,
  Search,
  Filter,
} from "lucide-react";
import { setProjectBudget, getFinanceBudgets, type ProjectBudgetUploadLine } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export type BudgetRowItem = {
  id: string;
  cost_code: string;
  description: string;
  cost_category: "labour" | "equipment" | "materials" | "subcontract" | "overhead" | "other";
  quantity: number;
  unit: string;
  unit_rate: number;
  amount: number;
  notes?: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  labour: "text-cyan-400 border-cyan-500/30 bg-cyan-950/20",
  equipment: "text-amber-400 border-amber-500/30 bg-amber-950/20",
  materials: "text-emerald-400 border-emerald-500/30 bg-emerald-950/20",
  subcontract: "text-purple-400 border-purple-500/30 bg-purple-950/20",
  overhead: "text-rose-400 border-rose-500/30 bg-rose-950/20",
  other: "text-slate-400 border-slate-500/30 bg-slate-950/20",
};

export function ProjectBudgetSpreadsheet({
  projectId,
  contractValue = 0,
  onBudgetSaved,
}: {
  projectId: string;
  contractValue?: number;
  onBudgetSaved?: (newTotal: number) => void;
}) {
  const [rows, setRows] = useState<BudgetRowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [budgetStage, setBudgetStage] = useState<"master" | "execution">("master");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [filterText, setFilterText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pasteBuffer, setPasteBuffer] = useState("");

  // Load existing budget lines
  const loadExistingBudget = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await getFinanceBudgets({ project_id: projectId });
      const budgets = res.data || [];
      const current = budgets.find((b: any) => b.status === "approved" || b.status === "active") || budgets[0];
      if (current && Array.isArray(current.lines) && current.lines.length > 0) {
        setRows(
          current.lines.map((l: any, idx: number) => ({
            id: l.id || `line-${idx}`,
            cost_code: l.cost_code || l.cost_code_name || `CC-${100 + idx}`,
            description: l.description || "Uncategorized Item",
            cost_category: (l.cost_category || "materials") as any,
            quantity: Number(l.quantity) || 1,
            unit: l.unit || "sum",
            unit_rate: Number(l.unit_rate) || Number(l.amount) || 0,
            amount: Number(l.amount) || 0,
            notes: l.notes || "",
          }))
        );
      } else {
        // Initial clean template rows if empty
        setRows([
          { id: "row-1", cost_code: "100-LABOUR", description: "Direct Site Labour & Supervision", cost_category: "labour", quantity: 1, unit: "sum", unit_rate: 0, amount: 0 },
          { id: "row-2", cost_code: "200-MATERIALS", description: "Concrete, Cement & Aggregates", cost_category: "materials", quantity: 1, unit: "sum", unit_rate: 0, amount: 0 },
          { id: "row-3", cost_code: "300-EQUIP", description: "Plant & Heavy Machinery Hire", cost_category: "equipment", quantity: 1, unit: "sum", unit_rate: 0, amount: 0 },
          { id: "row-4", cost_code: "400-SUBCONT", description: "Specialist Subcontractor Packages", cost_category: "subcontract", quantity: 1, unit: "sum", unit_rate: 0, amount: 0 },
        ]);
      }
    } catch {
      // Fallback clean template
      setRows([
        { id: "row-1", cost_code: "100-LABOUR", description: "Direct Site Labour & Supervision", cost_category: "labour", quantity: 1, unit: "sum", unit_rate: 0, amount: 0 },
        { id: "row-2", cost_code: "200-MATERIALS", description: "Materials & Consumables Allowance", cost_category: "materials", quantity: 1, unit: "sum", unit_rate: 0, amount: 0 },
      ]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadExistingBudget();
  }, [loadExistingBudget]);

  const updateRow = useCallback((id: string, patch: Partial<BudgetRowItem>) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, ...patch };
        if ("quantity" in patch || "unit_rate" in patch) {
          updated.amount = Math.round((updated.quantity * updated.unit_rate) * 100) / 100;
        }
        return updated;
      })
    );
  }, []);

  const addRow = useCallback(() => {
    const newId = `row-${Date.now()}`;
    setRows((prev) => [
      ...prev,
      {
        id: newId,
        cost_code: `CC-${prev.length + 101}`,
        description: "",
        cost_category: "materials",
        quantity: 1,
        unit: "unit",
        unit_rate: 0,
        amount: 0,
      },
    ]);
  }, []);

  const duplicateRow = useCallback((id: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx === -1) return prev;
      const target = prev[idx];
      const dup = { ...target, id: `row-${Date.now()}`, description: `${target.description} (Copy)` };
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      return next;
    });
  }, []);

  const deleteRow = useCallback((id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }, []);

  // Financial aggregates
  const totalBudget = useMemo(() => {
    return rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }, [rows]);

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {
      labour: 0,
      equipment: 0,
      materials: 0,
      subcontract: 0,
      overhead: 0,
      other: 0,
    };
    rows.forEach((r) => {
      if (totals[r.cost_category] !== undefined) {
        totals[r.cost_category] += Number(r.amount) || 0;
      } else {
        totals.other += Number(r.amount) || 0;
      }
    });
    return totals;
  }, [rows]);

  const grossProfit = contractValue > 0 ? contractValue - totalBudget : 0;
  const grossMarginPct = contractValue > 0 ? Math.round((grossProfit / contractValue) * 100) : 0;
  const markupPct = totalBudget > 0 && contractValue > 0 ? Math.round(((contractValue - totalBudget) / totalBudget) * 100) : 0;

  // Save budget handler
  const handleSaveBudget = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const linesPayload: ProjectBudgetUploadLine[] = rows
        .filter((r) => r.cost_code.trim() && r.amount > 0)
        .map((r, idx) => ({
          cost_code: r.cost_code.trim(),
          description: r.description.trim() || r.cost_code.trim(),
          cost_category: r.cost_category,
          quantity: r.quantity,
          unit: r.unit,
          unit_rate: r.unit_rate,
          amount: r.amount,
          source_line: idx + 1,
        }));

      const res = await setProjectBudget(projectId, totalBudget, `Updated from Project Budget Studio (${budgetStage})`, {
        budgetStage,
        lines: linesPayload,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          message: budgetStage === "master"
            ? `Protected master budget baseline saved ($${totalBudget.toLocaleString()}).`
            : `Execution budget review saved with ${linesPayload.length} lines.`,
        });
        if (onBudgetSaved) onBudgetSaved(totalBudget);
      } else {
        throw new Error(res.message || "Failed to save budget.");
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Error saving budget.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Export to CSV
  const handleExportCsv = () => {
    const headers = ["Cost Code", "Category", "Description", "Quantity", "Unit", "Unit Rate (USD)", "Amount (USD)", "Notes"];
    const csvContent = [
      headers.join(","),
      ...rows.map((r) =>
        [
          `"${r.cost_code}"`,
          `"${r.cost_category}"`,
          `"${r.description.replace(/"/g, '""')}"`,
          r.quantity,
          `"${r.unit}"`,
          r.unit_rate,
          r.amount,
          `"${(r.notes || "").replace(/"/g, '""')}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Project_Budget_${projectId}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Import pasted TSV/CSV data
  const handleCommitPastedData = () => {
    if (!pasteBuffer.trim()) return;
    const lines = pasteBuffer.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const parsedRows: BudgetRowItem[] = [];

    lines.forEach((line, idx) => {
      // Split on tab or comma
      const delimiter = line.includes("\t") ? "\t" : ",";
      const parts = line.split(delimiter).map((p) => p.trim().replace(/^["']|["']$/g, ""));
      if (parts.length >= 2) {
        const code = parts[0] || `CC-${idx + 1}`;
        const desc = parts[1] || code;
        const qty = parts[2] ? Number(parts[2].replace(/[^0-9.-]/g, "")) || 1 : 1;
        const unit = parts[3] || "sum";
        const rate = parts[4] ? Number(parts[4].replace(/[^0-9.-]/g, "")) || 0 : 0;
        const amount = parts[5] ? Number(parts[5].replace(/[^0-9.-]/g, "")) || qty * rate : qty * rate;

        parsedRows.push({
          id: `pasted-${idx}`,
          cost_code: code,
          description: desc,
          cost_category: "materials",
          quantity: qty,
          unit,
          unit_rate: rate,
          amount: Math.round(amount * 100) / 100,
        });
      }
    });

    if (parsedRows.length > 0) {
      setRows(parsedRows);
      setIsImportModalOpen(false);
      setPasteBuffer("");
      setFeedback({
        type: "success",
        message: `Imported ${parsedRows.length} lines from pasted clipboard data.`,
      });
    }
  };

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const matchesSearch =
        r.cost_code.toLowerCase().includes(filterText.toLowerCase()) ||
        r.description.toLowerCase().includes(filterText.toLowerCase());
      const matchesCategory = selectedCategory === "all" || r.cost_category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [rows, filterText, selectedCategory]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 text-slate-light font-mono text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-signal" />
        Loading project budget lines...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Controls & Financial KPI Strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Contract Revenue</span>
          <p className="mt-1 font-mono text-2xl font-bold text-paper">
            {contractValue > 0 ? formatCurrency(contractValue) : "Unrecorded"}
          </p>
          <span className="text-[11px] text-slate-light">Agreed project contract ceiling</span>
        </div>

        <div className="border border-signal/40 bg-signal/5 p-4">
          <span className="font-mono text-[10px] uppercase text-signal">Total Target Budget</span>
          <p className="mt-1 font-mono text-2xl font-bold text-signal">
            {formatCurrency(totalBudget)}
          </p>
          <span className="text-[11px] text-slate-light">Sum of all planned cost codes</span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Gross Margin</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`font-mono text-2xl font-bold ${grossMarginPct >= 20 ? "text-emerald-400" : "text-amber-400"}`}>
              {contractValue > 0 ? `${grossMarginPct}%` : "—"}
            </span>
            <span className="text-xs text-slate-light">
              ({formatCurrency(grossProfit)})
            </span>
          </div>
          <span className="text-[11px] text-slate-light">Contract minus planned budget</span>
        </div>

        <div className="border border-ink-mid bg-ink/70 p-4">
          <span className="font-mono text-[10px] uppercase text-slate">Budget Markup</span>
          <p className="mt-1 font-mono text-2xl font-bold text-cyan-400">
            {markupPct > 0 ? `+${markupPct}%` : "—"}
          </p>
          <span className="text-[11px] text-slate-light">Margin markup over cost baseline</span>
        </div>
      </section>

      {/* Category Distribution Pills */}
      <section className="border border-ink-mid bg-ink/70 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-slate">
            Cost Category Distribution
          </h3>
          <span className="font-mono text-[10px] text-slate-light">
            Total {rows.length} Cost Items
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(categoryTotals).map(([cat, amount]) => {
            const pct = totalBudget > 0 ? Math.round((amount / totalBudget) * 100) : 0;
            return (
              <div
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? "all" : cat)}
                className={`cursor-pointer border p-2.5 transition-all ${
                  selectedCategory === cat ? "border-signal bg-signal/10" : "border-ink-mid bg-ink-light/20 hover:border-slate"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] uppercase font-mono">
                  <span className="text-slate-light font-medium">{cat}</span>
                  <span className="font-bold text-paper">{pct}%</span>
                </div>
                <p className="mt-1 font-mono text-xs font-semibold text-paper">
                  {formatCurrency(amount)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Action Toolbar */}
      <section className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-mid/60 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Stage switch */}
          <div className="flex border border-ink-mid bg-ink-light">
            <button
              type="button"
              onClick={() => setBudgetStage("master")}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                budgetStage === "master" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
              }`}
            >
              Master Baseline
            </button>
            <button
              type="button"
              onClick={() => setBudgetStage("execution")}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                budgetStage === "execution" ? "bg-signal text-ink font-bold" : "text-slate-light hover:text-paper"
              }`}
            >
              Execution Review
            </button>
          </div>

          {/* Search and Category filter */}
          <div className="flex items-center gap-2">
            <label className="flex h-9 items-center gap-2 border border-ink-mid bg-ink-light px-2.5">
              <Search className="h-3.5 w-3.5 text-slate" />
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter code or item..."
                className="w-36 sm:w-48 bg-transparent text-xs outline-none placeholder:text-slate text-paper font-mono"
              />
            </label>
            {selectedCategory !== "all" && (
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className="border border-ink-mid px-2 py-1 text-[11px] font-mono text-slate-light hover:text-paper"
              >
                Reset Filter
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex h-9 items-center gap-1.5 border border-ink-mid bg-ink-light px-3 font-mono text-xs text-paper hover:border-signal transition-colors"
          >
            <Plus className="h-3.5 w-3.5 text-signal" />
            <span>Add Line</span>
          </button>
          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 border border-ink-mid bg-ink-light px-3 font-mono text-xs text-paper hover:border-signal transition-colors"
          >
            <Upload className="h-3.5 w-3.5 text-slate" />
            <span>Import / Paste</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex h-9 items-center gap-1.5 border border-ink-mid bg-ink-light px-3 font-mono text-xs text-paper hover:border-signal transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-slate" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handleSaveBudget}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 border border-signal bg-signal px-4 font-mono text-xs font-bold uppercase tracking-wider text-ink hover:bg-signal/90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>Save Budget</span>
          </button>
        </div>
      </section>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`flex items-center gap-2.5 border p-3 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
              : "border-red-500/40 bg-red-950/20 text-red-300"
          }`}
        >
          {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* High-Performance Spreadsheet Table */}
      <section className="overflow-x-auto border border-ink-mid bg-ink">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-ink-mid bg-ink-light/50 font-mono text-[11px] text-slate uppercase tracking-wider">
              <th className="py-2.5 px-3 w-12 text-center">#</th>
              <th className="py-2.5 px-3 w-36">Cost Code</th>
              <th className="py-2.5 px-3 w-32">Category</th>
              <th className="py-2.5 px-3 min-w-[240px]">Item Description</th>
              <th className="py-2.5 px-3 w-24 text-right">Quantity</th>
              <th className="py-2.5 px-3 w-20">Unit</th>
              <th className="py-2.5 px-3 w-28 text-right">Unit Rate ($)</th>
              <th className="py-2.5 px-3 w-32 text-right">Total ($)</th>
              <th className="py-2.5 px-3 w-20 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-mid/40 font-mono">
            {filteredRows.map((row, index) => (
              <tr key={row.id} className="hover:bg-ink-light/30 transition-colors">
                <td className="py-2 px-3 text-center text-slate font-mono text-[11px]">
                  {index + 1}
                </td>

                <td className="py-2 px-3">
                  <input
                    value={row.cost_code}
                    onChange={(e) => updateRow(row.id, { cost_code: e.target.value })}
                    className="w-full border border-ink-mid bg-ink-light/30 px-2 py-1 text-xs text-paper focus:border-signal outline-none font-mono"
                    placeholder="e.g. 101-CONC"
                  />
                </td>

                <td className="py-2 px-3">
                  <select
                    value={row.cost_category}
                    onChange={(e) => updateRow(row.id, { cost_category: e.target.value as any })}
                    className="w-full border border-ink-mid bg-ink-light/40 px-2 py-1 text-[11px] text-paper focus:border-signal outline-none uppercase font-mono"
                  >
                    <option value="labour">Labour</option>
                    <option value="equipment">Equipment</option>
                    <option value="materials">Materials</option>
                    <option value="subcontract">Subcontract</option>
                    <option value="overhead">Overhead</option>
                    <option value="other">Other</option>
                  </select>
                </td>

                <td className="py-2 px-3">
                  <input
                    value={row.description}
                    onChange={(e) => updateRow(row.id, { description: e.target.value })}
                    className="w-full border border-ink-mid bg-ink-light/30 px-2 py-1 text-xs text-paper focus:border-signal outline-none"
                    placeholder="Description of work, material, or labour..."
                  />
                </td>

                <td className="py-2 px-3 text-right">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.id, { quantity: Number(e.target.value) || 0 })}
                    className="w-full text-right border border-ink-mid bg-ink-light/30 px-2 py-1 text-xs text-paper focus:border-signal outline-none font-mono"
                  />
                </td>

                <td className="py-2 px-3">
                  <input
                    value={row.unit}
                    onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                    className="w-full border border-ink-mid bg-ink-light/30 px-2 py-1 text-xs text-paper focus:border-signal outline-none uppercase font-mono"
                    placeholder="m3, kg"
                  />
                </td>

                <td className="py-2 px-3 text-right">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={row.unit_rate}
                    onChange={(e) => updateRow(row.id, { unit_rate: Number(e.target.value) || 0 })}
                    className="w-full text-right border border-ink-mid bg-ink-light/30 px-2 py-1 text-xs text-paper focus:border-signal outline-none font-mono"
                  />
                </td>

                <td className="py-2 px-3 text-right font-bold text-signal font-mono">
                  {formatCurrency(row.amount)}
                </td>

                <td className="py-2 px-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => duplicateRow(row.id)}
                      title="Duplicate Line"
                      className="text-slate hover:text-paper p-1"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteRow(row.id)}
                      title="Delete Line"
                      className="text-slate hover:text-red-400 p-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-signal/60 bg-ink-light/60 font-mono font-bold text-sm">
              <td colSpan={7} className="py-3 px-4 text-right uppercase tracking-wider text-paper">
                Total Budgeted Amount:
              </td>
              <td className="py-3 px-3 text-right text-signal text-base">
                {formatCurrency(totalBudget)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* Paste / Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl border border-ink-mid bg-ink p-6 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-paper">
              Paste BOQ or Spreadsheet Data
            </h3>
            <p className="mt-1 text-xs text-slate-light leading-relaxed">
              Paste rows copied directly from Excel, Google Sheets, or CSV. Expected columns:
              <br />
              <code className="text-signal font-mono text-[11px]">Cost Code [tab] Description [tab] Quantity [tab] Unit [tab] Unit Rate [tab] Total Amount</code>
            </p>

            <textarea
              rows={8}
              value={pasteBuffer}
              onChange={(e) => setPasteBuffer(e.target.value)}
              placeholder="Paste spreadsheet lines here..."
              className="mt-4 w-full border border-ink-mid bg-ink-light p-3 font-mono text-xs text-paper outline-none focus:border-signal"
            />

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="border border-ink-mid px-4 py-2 font-mono text-xs uppercase text-slate-light hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitPastedData}
                disabled={!pasteBuffer.trim()}
                className="border border-signal bg-signal px-4 py-2 font-mono text-xs font-bold uppercase text-ink hover:bg-signal/90 disabled:opacity-50"
              >
                Apply to Spreadsheet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
