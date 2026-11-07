"use client";

import { ProjectsPage } from "./ProjectsPage";

// Page files may only export route-segment config + the default component
// (Next 16 type-checks this), so the shared workspace and its helpers live in
// ./ProjectsPage.
export default function ProjectsDashboard() {
  return <ProjectsPage initialTab="dashboard" />;
}
