"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { FolderOpen, FileText, Layers } from "lucide-react";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";
import { ControlledDrawingsWorkspace } from "@/components/projects/ControlledDrawingsWorkspace";

export default function ProjectDocumentsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const [docTab, setDocTab] = useState<"drawings" | "store">("drawings");

  return (
    <div className="space-y-6">
      {/* View Switcher */}
      <div className="flex border-b border-ink-mid">
        <button
          type="button"
          onClick={() => setDocTab("drawings")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors ${
            docTab === "drawings"
              ? "border-signal text-signal font-bold bg-signal/5"
              : "border-transparent text-slate hover:text-paper hover:bg-ink-light/40"
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Controlled Drawings &amp; Photo Diary</span>
        </button>
        <button
          type="button"
          onClick={() => setDocTab("store")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors ${
            docTab === "store"
              ? "border-signal text-signal font-bold bg-signal/5"
              : "border-transparent text-slate hover:text-paper hover:bg-ink-light/40"
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          <span>Contract &amp; Document Store</span>
        </button>
      </div>

      {docTab === "drawings" ? (
        <ControlledDrawingsWorkspace projectId={projectId} />
      ) : (
        <div className="border border-ink-mid bg-ink p-5">
          <EntityDocumentsPanel
            entityType="project"
            entityId={projectId}
          />
        </div>
      )}
    </div>
  );
}
