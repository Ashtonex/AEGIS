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
          Direct Planning Budget Workspace
        </h2>
        <p className="mt-1 text-xs text-slate-light max-w-3xl">
          Build and edit your line-item WBS, assign cost codes, import BOQs, and adjust quantities directly.
          Planning is immediately enabled in any project lifecycle stage.
        </p>
      </div>

      <ProjectBudgetSpreadsheet
        projectId={projectId}
        contractValue={contractValue}
        onBudgetSaved={() => {
          void refetch();
        }}
      />
    </div>
  );
}
