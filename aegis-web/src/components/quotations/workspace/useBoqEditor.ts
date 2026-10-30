"use client";

/**
 * BOQ editing state with undo/redo. Every structural or value change goes
 * through one reducer so undo covers edits, inserts, moves, deletes, fill-down
 * and pastes alike. History is local to this browser tab; it is not a
 * substitute for revisions.
 */
import { useCallback, useReducer } from "react";
import { BoqLine, DEFAULT_SECTION, newLineId } from "./domain";

type Action =
  | { type: "reset"; lines: BoqLine[] }
  | { type: "update"; lineId: string; patch: Partial<BoqLine> }
  | { type: "insert"; afterLineId: string | null; lines: BoqLine[] }
  | { type: "remove"; lineIds: string[] }
  | { type: "duplicate"; lineId: string }
  | { type: "move"; lineId: string; direction: -1 | 1 }
  | { type: "fillDown"; lineIds: string[]; field: keyof BoqLine }
  | { type: "replaceMany"; lines: BoqLine[] }
  | { type: "undo" }
  | { type: "redo" };

interface State {
  lines: BoqLine[];
  past: BoqLine[][];
  future: BoqLine[][];
  revision: number; // bumps on every change; drives dirty tracking
}

const HISTORY_LIMIT = 200;

function commit(state: State, lines: BoqLine[]): State {
  if (lines === state.lines) return state;
  return {
    lines,
    past: [...state.past.slice(-HISTORY_LIMIT + 1), state.lines],
    future: [],
    revision: state.revision + 1,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { lines: action.lines, past: [], future: [], revision: state.revision + 1 };
    case "update": {
      const idx = state.lines.findIndex((l) => l.line_id === action.lineId);
      if (idx < 0) return state;
      const current = state.lines[idx];
      const changed = Object.entries(action.patch).some(([k, v]) => (current as Record<string, unknown>)[k] !== v);
      if (!changed) return state;
      const lines = state.lines.slice();
      lines[idx] = { ...current, ...action.patch };
      return commit(state, lines);
    }
    case "insert": {
      const lines = state.lines.slice();
      const idx = action.afterLineId === null ? -1 : lines.findIndex((l) => l.line_id === action.afterLineId);
      lines.splice(idx + 1, 0, ...action.lines);
      return commit(state, lines);
    }
    case "remove": {
      const drop = new Set(action.lineIds);
      return commit(state, state.lines.filter((l) => !drop.has(l.line_id)));
    }
    case "duplicate": {
      const idx = state.lines.findIndex((l) => l.line_id === action.lineId);
      if (idx < 0) return state;
      const source = state.lines[idx];
      const copy: BoqLine = {
        ...source,
        line_id: newLineId(),
        buildup: source.buildup.map((b) => ({ ...b })),
        takeoff: null,
        review_status: "unreviewed",
      };
      const lines = state.lines.slice();
      lines.splice(idx + 1, 0, copy);
      return commit(state, lines);
    }
    case "move": {
      // Moves within the line's own section (change the section field to
      // move a line to another bill/element).
      const idx = state.lines.findIndex((l) => l.line_id === action.lineId);
      if (idx < 0) return state;
      let target = idx + action.direction;
      while (target >= 0 && target < state.lines.length && state.lines[target].section !== state.lines[idx].section) {
        target += action.direction;
      }
      if (target < 0 || target >= state.lines.length) return state;
      const lines = state.lines.slice();
      [lines[idx], lines[target]] = [lines[target], lines[idx]];
      return commit(state, lines);
    }
    case "fillDown": {
      if (action.lineIds.length < 2) return state;
      const ids = new Set(action.lineIds);
      const first = state.lines.find((l) => ids.has(l.line_id));
      if (!first) return state;
      const value = first[action.field];
      const lines = state.lines.map((l) => (ids.has(l.line_id) && l !== first ? { ...l, [action.field]: value } : l));
      return commit(state, lines);
    }
    case "replaceMany": {
      const byId = new Map(action.lines.map((l) => [l.line_id, l]));
      return commit(state, state.lines.map((l) => byId.get(l.line_id) ?? l));
    }
    case "undo": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return { lines: previous, past: state.past.slice(0, -1), future: [state.lines, ...state.future], revision: state.revision + 1 };
    }
    case "redo": {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { lines: next, past: [...state.past, state.lines], future: rest, revision: state.revision + 1 };
    }
    default:
      return state;
  }
}

export function blankLine(section = DEFAULT_SECTION): BoqLine {
  return { line_id: newLineId(), section, item_no: "", description: "", item_type: "measured", qty: 0, unit: "", rate: 0, buildup: [], review_status: "unreviewed" };
}

export function useBoqEditor(initial: BoqLine[]) {
  const [state, dispatch] = useReducer(reducer, { lines: initial, past: [], future: [], revision: 0 });
  return {
    lines: state.lines,
    revision: state.revision,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    reset: useCallback((lines: BoqLine[]) => dispatch({ type: "reset", lines }), []),
    update: useCallback((lineId: string, patch: Partial<BoqLine>) => dispatch({ type: "update", lineId, patch }), []),
    insert: useCallback((afterLineId: string | null, lines: BoqLine[]) => dispatch({ type: "insert", afterLineId, lines }), []),
    remove: useCallback((lineIds: string[]) => dispatch({ type: "remove", lineIds }), []),
    duplicate: useCallback((lineId: string) => dispatch({ type: "duplicate", lineId }), []),
    move: useCallback((lineId: string, direction: -1 | 1) => dispatch({ type: "move", lineId, direction }), []),
    fillDown: useCallback((lineIds: string[], field: keyof BoqLine) => dispatch({ type: "fillDown", lineIds, field }), []),
    replaceMany: useCallback((lines: BoqLine[]) => dispatch({ type: "replaceMany", lines }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
  };
}

export type BoqEditor = ReturnType<typeof useBoqEditor>;
