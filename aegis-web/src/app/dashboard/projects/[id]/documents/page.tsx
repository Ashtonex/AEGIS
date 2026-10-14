"use client";

import React from "react";
import { useParams } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { EntityDocumentsPanel } from "@/components/documents/EntityDocumentsPanel";

export default function ProjectDocumentsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
          Controlled Project Drawings & Documents
        </h2>
        <p className="mt-1 text-xs text-slate-light">
          Drawings, specifications, bill of quantities, contracts, and revisions attached to this project.
        </p>
      </div>

      <div className="border border-ink-mid bg-ink p-5">
        <EntityDocumentsPanel
          entityType="project"
          entityId={projectId}
        />
      </div>
    </div>
  );
}
