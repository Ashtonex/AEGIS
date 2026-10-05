"use client";

import { useEffect, useState } from "react";
import { getMyPermissions } from "@/lib/api";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { ReportingTree } from "@/components/people/ReportingTree";

export default function WorkforceOrganisation() {
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    void getMyPermissions()
      .then((r) => {
        const keys: string[] = Array.isArray(r.data) ? r.data : [];
        setCanEdit(keys.includes("*") || keys.includes("workforce.people.update"));
      })
      .catch(() => setCanEdit(false));
  }, []);

  return (
    <main className="space-y-6 p-4 md:p-8">
      <DashboardPageHeader
        backHref="/dashboard/workforce"
        backLabel="Back to Workforce Command"
        title="Reporting Lines"
        subtitle="Who reports to whom at Six Nine Construction. Set each person's line manager; the org chart and approvals follow it."
      />
      <ReportingTree canEdit={canEdit} />
    </main>
  );
}
