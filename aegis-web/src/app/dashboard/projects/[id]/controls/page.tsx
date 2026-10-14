"use client";

import React, { useMemo } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/context/ProjectWorkspaceContext";
import { ProjectGovernanceWorkspace } from "@/components/projects/controls/ProjectGovernanceWorkspace";
import { number, text } from "@/lib/projects/types";

export default function ProjectControlsPage() {
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { project, detail, refetch } = useProject();

  const source = detail?.project ?? project;
  const contractValue = useMemo(() => {
    return number(source?.contract_value ?? source?.budget ?? source?.budget_value) ?? 0;
  }, [source]);

  return (
    <div className="space-y-6">
      <ProjectGovernanceWorkspace
        projectId={projectId}
        status={text(source?.status, "planning")}
        contractValue={contractValue}
        onStatusUpdated={() => {
          void refetch();
        }}
      />
    </div>
  );
}
