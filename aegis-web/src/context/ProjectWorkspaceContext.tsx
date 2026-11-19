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

/** The project's UUID when rendered inside a project workspace (routes can
 * use the project code), else the id given. Live events carry the UUID. */
export function useProjectUuid(projectId: string): string {
  const context = useContext(ProjectWorkspaceContext);
  const id = (context?.project as { id?: string } | null | undefined)?.id;
  return id ? String(id) : projectId;
}

export function useProject(): ProjectWorkspaceData {
  const context = useContext(ProjectWorkspaceContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectWorkspaceProvider");
  }
  return context;
}
