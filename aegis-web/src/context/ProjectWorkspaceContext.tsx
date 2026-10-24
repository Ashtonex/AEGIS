"use client";

import React, { createContext, useContext } from "react";
import { useProjectWorkspace, type ProjectWorkspaceData } from "@/hooks/useProjectWorkspace";

const ProjectWorkspaceContext = createContext<ProjectWorkspaceData | null>(null);

export function ProjectWorkspaceProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const workspace = useProjectWorkspace(projectId);

  return (
    <ProjectWorkspaceContext.Provider value={workspace}>
      {children}
    </ProjectWorkspaceContext.Provider>
  );
}

export function useProject(): ProjectWorkspaceData {
  const context = useContext(ProjectWorkspaceContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectWorkspaceProvider");
  }
  return context;
}
