"use client";

import { useState } from "react";
import { X, Paperclip, ListChecks, UserCog } from "lucide-react";
import { EntityDocumentsPanel, type DocumentEntityType } from "./EntityDocumentsPanel";
import { TenderChecklistPanel } from "./TenderChecklistPanel";
import { AssignmentPanel } from "./AssignmentPanel";

/**
 * Slide-over drawer for attaching/downloading/previewing documents and
 * assigning a single lead/opportunity/tender/project/fleet/machinery record.
 * Tenders get an extra Checklist tab (crm.tender_requirements).
 */
export function EntityDocumentsDrawer({
  entityType,
  entityId,
  entityLabel,
  onClose,
}: {
  entityType: DocumentEntityType;
  entityId: string;
  entityLabel: string;
  onClose: () => void;
}) {
  const showChecklist = entityType === "tender";
  const [tab, setTab] = useState<"documents" | "checklist" | "assign">("documents");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-ink-mid bg-ink shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-mid p-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Documents</p>
            <p className="truncate text-sm font-semibold text-paper">{entityLabel}</p>
          </div>
          <button onClick={onClose} className="text-slate-light hover:text-paper"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex border-b border-ink-mid">
          <button
            onClick={() => setTab("documents")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs uppercase tracking-wider ${tab === "documents" ? "border-b-2 border-signal text-paper" : "text-slate-light hover:text-paper"}`}
          >
            <Paperclip className="h-3.5 w-3.5" /> Documents
          </button>
          {showChecklist && (
            <button
              onClick={() => setTab("checklist")}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs uppercase tracking-wider ${tab === "checklist" ? "border-b-2 border-signal text-paper" : "text-slate-light hover:text-paper"}`}
            >
              <ListChecks className="h-3.5 w-3.5" /> Checklist
            </button>
          )}
          <button
            onClick={() => setTab("assign")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs uppercase tracking-wider ${tab === "assign" ? "border-b-2 border-signal text-paper" : "text-slate-light hover:text-paper"}`}
          >
            <UserCog className="h-3.5 w-3.5" /> Assign
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "documents" && <EntityDocumentsPanel entityType={entityType} entityId={entityId} />}
          {tab === "checklist" && showChecklist && <TenderChecklistPanel tenderId={entityId} />}
          {tab === "assign" && <AssignmentPanel entityType={entityType} entityId={entityId} />}
        </div>
      </div>
    </div>
  );
}
