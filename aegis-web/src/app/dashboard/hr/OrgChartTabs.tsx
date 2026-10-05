"use client";

import { useState } from "react";
import { OrgStructureChart } from "@/components/people/OrgStructureChart";
import { ReportingTree } from "@/components/people/ReportingTree";

const VIEWS = [
  { key: "group", label: "Group structure" },
  { key: "management", label: "Management structure" },
  { key: "reporting", label: "Reporting lines" },
] as const;

type View = (typeof VIEWS)[number]["key"];

/** The org chart page: two drawn organograms plus the editable line-manager tree. */
export function OrgChartTabs() {
  const [view, setView] = useState<View>("group");
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-ink-mid">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${view === v.key ? "border-signal text-paper" : "border-transparent text-slate-light hover:text-paper"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "reporting" ? <ReportingTree canEdit /> : <OrgStructureChart chart={view} />}
    </div>
  );
}
