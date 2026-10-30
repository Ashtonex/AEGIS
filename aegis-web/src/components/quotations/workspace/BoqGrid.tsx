"use client";

/**
 * Spreadsheet-style BOQ grid.
 *
 * Two modes, like a spreadsheet:
 *  - navigate: arrows / Tab / Shift+Tab / Enter / Shift+Enter move the active
 *    cell, Shift+Up/Down extends a range in the column, Enter or F2 or typing
 *    starts an edit, Ctrl+D fills the range down, Ctrl+Z / Ctrl+Y undo/redo,
 *    Ctrl+V pastes (multi-cell goes to the mapping preview), Delete clears.
 *  - edit: the input owns every key (arrows, Home/End, Ctrl+Z inside the
 *    text) except Enter / Shift+Enter / Tab / Shift+Tab (commit and move) and
 *    Escape (cancel).
 *
 * Rows are virtualised (fixed row height, only the visible window plus
 * overscan is rendered), so a 1,000+ line bill stays responsive.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, CircleAlert, Info, Ruler } from "lucide-react";
import type { ReviewFlag } from "@/lib/api/quotations";
import { BoqLine, ItemType, formatMoney, formatQty, lineAmount } from "./domain";

export const ROW_HEIGHT = 34;
const OVERSCAN = 12;

type ColKey = "item_no" | "description" | "item_type" | "qty" | "unit" | "rate";
const COLUMNS: Array<{ key: ColKey | "amount" | "status"; label: string; width: string; align?: "right"; editable: boolean }> = [
  { key: "item_no", label: "Code", width: "84px", editable: true },
  { key: "description", label: "Description", width: "minmax(260px,1fr)", editable: true },
  { key: "item_type", label: "Type", width: "96px", editable: true },
  { key: "qty", label: "Qty", width: "96px", align: "right", editable: true },
  { key: "unit", label: "Unit", width: "64px", editable: true },
  { key: "rate", label: "Cost rate", width: "110px", align: "right", editable: true },
  { key: "amount", label: "Cost amount", width: "124px", align: "right", editable: false },
  { key: "status", label: "", width: "44px", editable: false },
];
const EDITABLE: ColKey[] = ["item_no", "description", "item_type", "qty", "unit", "rate"];
const GRID_TEMPLATE = COLUMNS.map((c) => c.width).join(" ");
const ITEM_TYPE_LABEL: Record<ItemType, string> = { measured: "Measured", lump_sum: "Lump sum", provisional: "Provisional", note: "Note" };

type DisplayRow =
  | { kind: "section"; section: string; amount: number; count: number; collapsed: boolean }
  | { kind: "line"; line: BoqLine; index: number };

interface Props {
  lines: BoqLine[];
  visibleLineIds: Set<string> | null;
  readOnly: boolean;
  currency: string;
  flagsByLine: Map<string, ReviewFlag[]>;
  activeLineId: string | null;
  onActiveLineChange: (lineId: string | null) => void;
  onUpdate: (lineId: string, patch: Partial<BoqLine>) => void;
  onFillDown: (lineIds: string[], field: keyof BoqLine) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPasteTable: (text: string, atLineId: string | null) => void;
  onAppendLine: () => void;
  height: number;
}

function cellText(line: BoqLine, key: ColKey): string {
  if (key === "qty") return line.item_type === "note" ? "" : String(line.qty ?? "");
  if (key === "rate") return line.item_type === "note" ? "" : String(line.rate ?? "");
  return String(line[key] ?? "");
}

function parseCell(key: ColKey, raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  if (key === "qty" || key === "rate") {
    const cleaned = raw.replace(/[,\s$]/g, "");
    if (cleaned === "") return { ok: true, value: 0 };
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { ok: false, message: `"${raw}" is not a number.` };
    if (n < 0) return { ok: false, message: "Negative values are not allowed - use the discount for credits." };
    return { ok: true, value: n };
  }
  if (key === "item_type") {
    const match = (Object.keys(ITEM_TYPE_LABEL) as ItemType[]).find(
      (t) => t === raw.trim().toLowerCase() || ITEM_TYPE_LABEL[t].toLowerCase() === raw.trim().toLowerCase(),
    );
    return match ? { ok: true, value: match } : { ok: false, message: `Type must be one of ${Object.values(ITEM_TYPE_LABEL).join(", ")}.` };
  }
  return { ok: true, value: raw };
}

export function BoqGrid(props: Props) {
  const { lines, visibleLineIds, readOnly, currency, flagsByLine, activeLineId, onActiveLineChange, onUpdate, onFillDown, onUndo, onRedo, onPasteTable, height } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeCol, setActiveCol] = useState<ColKey>("description");
  const [anchorLineId, setAnchorLineId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ lineId: string; col: ColKey; value: string; error?: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo<DisplayRow[]>(() => {
    const order: string[] = [];
    const groups = new Map<string, { lines: Array<{ line: BoqLine; index: number }>; amount: number }>();
    lines.forEach((line, index) => {
      if (!groups.has(line.section)) {
        groups.set(line.section, { lines: [], amount: 0 });
        order.push(line.section);
      }
      const g = groups.get(line.section)!;
      g.amount += lineAmount(line);
      if (!visibleLineIds || visibleLineIds.has(line.line_id)) g.lines.push({ line, index });
    });
    const out: DisplayRow[] = [];
    for (const section of order) {
      const g = groups.get(section)!;
      if (visibleLineIds && g.lines.length === 0) continue;
      const isCollapsed = collapsed.has(section);
      out.push({ kind: "section", section, amount: g.amount, count: g.lines.length, collapsed: isCollapsed });
      if (!isCollapsed) g.lines.forEach(({ line, index }) => out.push({ kind: "line", line, index }));
    }
    return out;
  }, [lines, visibleLineIds, collapsed]);

  const lineRows = useMemo(() => rows.filter((r): r is Extract<DisplayRow, { kind: "line" }> => r.kind === "line"), [rows]);
  const rowIndexByLine = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => r.kind === "line" && map.set(r.line.line_id, i));
    return map;
  }, [rows]);
  const lineOrder = useMemo(() => lineRows.map((r) => r.line.line_id), [lineRows]);

  const range = useMemo(() => {
    if (!activeLineId || !anchorLineId || anchorLineId === activeLineId) return activeLineId ? [activeLineId] : [];
    const a = lineOrder.indexOf(anchorLineId);
    const b = lineOrder.indexOf(activeLineId);
    if (a < 0 || b < 0) return [activeLineId];
    return lineOrder.slice(Math.min(a, b), Math.max(a, b) + 1);
  }, [activeLineId, anchorLineId, lineOrder]);
  const rangeSet = useMemo(() => new Set(range), [range]);

  const ensureVisible = useCallback((lineId: string) => {
    const idx = rowIndexByLine.get(lineId);
    const el = scrollRef.current;
    if (idx === undefined || !el) return;
    const top = idx * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight - ROW_HEIGHT) el.scrollTop = top - el.clientHeight + ROW_HEIGHT * 2;
  }, [rowIndexByLine]);

  const moveTo = useCallback((lineId: string | null, col: ColKey, extend = false) => {
    if (!lineId) return;
    if (!extend) setAnchorLineId(lineId);
    onActiveLineChange(lineId);
    setActiveCol(col);
    ensureVisible(lineId);
  }, [ensureVisible, onActiveLineChange]);

  useEffect(() => {
    if (activeLineId) ensureVisible(activeLineId);
    // only when the selection is changed from outside (e.g. a review flag link)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLineId]);

  const step = useCallback((dRow: number, dCol: number, extend = false) => {
    const pos = activeLineId ? lineOrder.indexOf(activeLineId) : -1;
    if (pos < 0) {
      if (lineOrder.length) moveTo(lineOrder[0], activeCol);
      return;
    }
    let col = EDITABLE.indexOf(activeCol) + dCol;
    let row = pos + dRow;
    if (col >= EDITABLE.length) { col = 0; row += 1; }
    if (col < 0) { col = EDITABLE.length - 1; row -= 1; }
    row = Math.max(0, Math.min(lineOrder.length - 1, row));
    moveTo(lineOrder[row], EDITABLE[col], extend);
  }, [activeCol, activeLineId, lineOrder, moveTo]);

  const startEdit = useCallback((initial?: string) => {
    if (readOnly || !activeLineId) return;
    const line = lines.find((l) => l.line_id === activeLineId);
    if (!line) return;
    setEditing({ lineId: line.line_id, col: activeCol, value: initial ?? cellText(line, activeCol) });
  }, [activeCol, activeLineId, lines, readOnly]);

  const commitEdit = useCallback((): boolean => {
    if (!editing) return true;
    const parsed = parseCell(editing.col, editing.value);
    if (!parsed.ok) {
      setEditing({ ...editing, error: parsed.message });
      return false;
    }
    const patch: Partial<BoqLine> = { [editing.col]: parsed.value } as Partial<BoqLine>;
    if (editing.col === "item_type" && parsed.value === "lump_sum") {
      const line = lines.find((l) => l.line_id === editing.lineId);
      if (line && !line.qty) Object.assign(patch, { qty: 1, unit: line.unit || "sum" });
    }
    if (editing.col === "rate") patch.rate_source = { type: "manual", date: new Date().toISOString().slice(0, 10) };
    onUpdate(editing.lineId, patch);
    setEditing(null);
    gridRef.current?.focus();
    return true;
  }, [editing, lines, onUpdate]);

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return; // the input handles its own keys
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) onRedo(); else onUndo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); onRedo(); return; }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (!readOnly && range.length > 1) onFillDown(range, activeCol);
      return;
    }
    if (mod) return; // leave Ctrl+C / Ctrl+V / browser shortcuts alone
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); step(1, 0, e.shiftKey); return;
      case "ArrowUp": e.preventDefault(); step(-1, 0, e.shiftKey); return;
      case "ArrowRight": e.preventDefault(); step(0, 1); return;
      case "ArrowLeft": e.preventDefault(); step(0, -1); return;
      case "Tab": e.preventDefault(); step(0, e.shiftKey ? -1 : 1); return;
      case "Enter": e.preventDefault(); if (e.shiftKey) step(-1, 0); else startEdit(); return;
      case "F2": e.preventDefault(); startEdit(); return;
      case "Delete":
      case "Backspace":
        if (!readOnly && activeLineId && activeCol !== "item_type") {
          e.preventDefault();
          const clear: Partial<BoqLine> = activeCol === "qty" || activeCol === "rate" ? { [activeCol]: 0 } : { [activeCol]: "" };
          range.forEach((id) => onUpdate(id, clear));
        }
        return;
      case "Escape": setAnchorLineId(activeLineId); return;
      default:
        if (e.key.length === 1 && !e.altKey) {
          e.preventDefault();
          startEdit(e.key);
        }
    }
  };

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Escape") { e.preventDefault(); setEditing(null); gridRef.current?.focus(); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (!commitEdit()) return;
      if (e.key === "Enter") step(e.shiftKey ? -1 : 1, 0);
      else step(0, e.shiftKey ? -1 : 1);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing || readOnly) return; // inside a cell the browser pastes text normally
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const multi = /[\t\n]/.test(text.replace(/\r?\n$/, ""));
    if (!multi && activeLineId) {
      const parsed = parseCell(activeCol, text.trim());
      if (parsed.ok) onUpdate(activeLineId, { [activeCol]: parsed.value } as Partial<BoqLine>);
      return;
    }
    onPasteTable(text, activeLineId);
  };

  const total = rows.length * ROW_HEIGHT;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  const toggleSection = (section: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const activeCellId = activeLineId ? `boq-cell-${activeLineId}-${activeCol}` : undefined;

  return (
    <div className="border border-ink-mid rounded-sm bg-ink overflow-hidden">
      <div ref={scrollRef} className="overflow-auto" style={{ height }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="min-w-[900px]">
          <div
            role="row"
            className="sticky top-0 z-10 grid bg-ink-light border-b border-ink-mid text-[11px] uppercase tracking-wider text-slate font-mono"
            style={{ gridTemplateColumns: GRID_TEMPLATE, height: ROW_HEIGHT }}
          >
            {COLUMNS.map((c) => (
              <div key={c.key} role="columnheader" className={`px-2 flex items-center ${c.align === "right" ? "justify-end" : ""}`}>{c.label}</div>
            ))}
          </div>
          <div
            ref={gridRef}
            role="grid"
            aria-label="Bill of quantities"
            aria-rowcount={lineRows.length}
            aria-activedescendant={activeCellId}
            aria-readonly={readOnly}
            tabIndex={0}
            onKeyDown={onGridKeyDown}
            onPaste={onPaste}
            className="relative outline-none focus-visible:ring-1 focus-visible:ring-signal/60"
            style={{ height: total }}
          >
            {rows.slice(first, last).map((row, i) => {
              const top = (first + i) * ROW_HEIGHT;
              if (row.kind === "section") {
                return (
                  <div
                    key={`s-${row.section}`}
                    className="absolute left-0 right-0 grid items-center bg-ink-high/60 border-b border-ink-mid text-xs font-semibold text-paper"
                    style={{ top, height: ROW_HEIGHT, gridTemplateColumns: GRID_TEMPLATE }}
                  >
                    <button
                      type="button"
                      className="col-span-6 flex items-center gap-1.5 px-2 text-left hover:text-signal"
                      onClick={() => toggleSection(row.section)}
                      aria-expanded={!row.collapsed}
                    >
                      {row.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span className="truncate">{row.section}</span>
                      <span className="text-slate font-normal">· {row.count} line{row.count === 1 ? "" : "s"}</span>
                    </button>
                    <div className="px-2 text-right font-mono tabular-nums">{formatMoney(row.amount, currency)}</div>
                    <div />
                  </div>
                );
              }
              const { line } = row;
              const isActiveRow = line.line_id === activeLineId;
              const flags = flagsByLine.get(line.line_id) || [];
              const worst = flags.find((f) => f.severity === "error") || flags.find((f) => f.severity === "warning") || flags[0];
              return (
                <div
                  key={line.line_id}
                  role="row"
                  aria-rowindex={lineOrder.indexOf(line.line_id) + 1}
                  aria-selected={isActiveRow}
                  className={`absolute left-0 right-0 grid border-b border-ink-mid/60 text-[13px] ${isActiveRow ? "bg-signal/5" : rangeSet.has(line.line_id) ? "bg-info-ghost" : "hover:bg-ink-light/60"} ${line.item_type === "note" ? "italic text-slate" : "text-paper"}`}
                  style={{ top, height: ROW_HEIGHT, gridTemplateColumns: GRID_TEMPLATE }}
                >
                  {COLUMNS.map((c) => {
                    if (c.key === "amount") {
                      return (
                        <div key={c.key} role="gridcell" className="px-2 flex items-center justify-end font-mono tabular-nums text-paper/90">
                          {line.item_type === "note" ? "" : formatMoney(lineAmount(line), currency)}
                        </div>
                      );
                    }
                    if (c.key === "status") {
                      return (
                        <div key={c.key} role="gridcell" className="flex items-center justify-center gap-0.5" title={flags.map((f) => f.message).join("\n")}>
                          {line.takeoff ? <Ruler className={`w-3.5 h-3.5 ${line.takeoff.verified ? "text-success" : "text-warning"}`} aria-label={line.takeoff.verified ? "Verified takeoff" : "Unverified takeoff"} /> : null}
                          {worst?.severity === "error" ? <CircleAlert className="w-3.5 h-3.5 text-danger" aria-label={worst.message} /> :
                            worst?.severity === "warning" ? <AlertTriangle className="w-3.5 h-3.5 text-warning" aria-label={worst.message} /> :
                              worst ? <Info className="w-3.5 h-3.5 text-slate" aria-label={worst.message} /> : null}
                        </div>
                      );
                    }
                    const key = c.key as ColKey;
                    const isActive = isActiveRow && activeCol === key;
                    const isEditing = editing && editing.lineId === line.line_id && editing.col === key;
                    const display = key === "item_type" ? ITEM_TYPE_LABEL[line.item_type] : key === "qty" ? (line.item_type === "note" ? "" : formatQty(line.qty)) : key === "rate" ? (line.item_type === "note" ? "" : formatMoney(line.rate, currency)) : cellText(line, key);
                    return (
                      <div
                        key={key}
                        id={`boq-cell-${line.line_id}-${key}`}
                        role="gridcell"
                        aria-selected={isActive}
                        className={`relative px-2 flex items-center min-w-0 ${c.align === "right" ? "justify-end font-mono tabular-nums" : ""} ${isActive ? "outline outline-1 outline-signal -outline-offset-1" : ""}`}
                        onMouseDown={(e) => {
                          if (isEditing) return;
                          e.preventDefault();
                          gridRef.current?.focus();
                          moveTo(line.line_id, key, e.shiftKey);
                        }}
                        onDoubleClick={() => startEdit()}
                      >
                        {isEditing ? (
                          key === "item_type" ? (
                            <select
                              autoFocus
                              aria-label="Line type"
                              className="w-full bg-void text-paper text-[13px] border border-signal rounded-sm px-1 py-0.5"
                              value={(parseCell("item_type", editing.value) as { ok: boolean; value?: string }).value as string || line.item_type}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={onEditorKeyDown}
                              onBlur={() => commitEdit()}
                            >
                              {(Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((t) => <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>)}
                            </select>
                          ) : (
                            <input
                              autoFocus
                              aria-label={c.label}
                              aria-invalid={!!editing.error}
                              title={editing.error}
                              inputMode={key === "qty" || key === "rate" ? "decimal" : undefined}
                              className={`w-full bg-void text-paper text-[13px] border rounded-sm px-1 py-0.5 ${editing.error ? "border-danger" : "border-signal"} ${c.align === "right" ? "text-right" : ""}`}
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value, error: undefined })}
                              onKeyDown={onEditorKeyDown}
                              onBlur={() => { if (!commitEdit()) setEditing(null); }}
                              onFocus={(e) => { if (editing.value.length === 1) e.currentTarget.setSelectionRange(1, 1); }}
                            />
                          )
                        ) : (
                          <span className="truncate" title={key === "description" ? line.description : undefined}>{display}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {!readOnly && (
            <button type="button" onClick={props.onAppendLine} className="w-full text-left px-3 py-2 text-xs text-slate hover:text-signal border-t border-ink-mid">
              + Add line
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
