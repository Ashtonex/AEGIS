"use client";

import React, { useMemo } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { ProjectBudgetSpreadsheet } from "@/components/projects/budget/ProjectBudgetSpreadsheet";
import { number } from "@/lib/projects/types";

export default function ProjectBudgetPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { project, detail, refetch } = useProject();

  const source = detail?.project ?? project;
  const contractValue = useMemo(() => {
    return number(source?.contract_value ?? source?.budget ?? source?.budget_value) ?? 0;
  }, [source]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-paper sm:text-2xl">
          Interactive Budget Planner &amp; BOQ Cost Controls
        </h2>
        <p className="mt-1 text-xs text-slate-light">
          Manage bulk BOQ cost-category totals (Materials, Labour, Plant, Subcontracts, Overheads, Contingency) linked directly to Quotations &amp; Estimations with real-time committed exposure and actual site spend side-by-side.
        </p>
      </div>

      <ProjectBudgetSpreadsheet
        projectId={project?.id || projectId}
        contractValue={contractValue}
        onBudgetSaved={() => {
          void refetch();
        }}
      />
    </div>
  );
}
