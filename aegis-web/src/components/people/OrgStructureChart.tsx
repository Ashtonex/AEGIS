"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Crown, Loader2, Users, X } from "lucide-react";
import { getPeopleRegister, type RegisterRow } from "@/lib/api";
import { PersonCardModal } from "./PersonCardModal";

/**
 * The two drawn organograms (group structure and management structure). The boxes are
 * fixed; the people in each box are worked out live from department and role, so the
 * chart fills in as HR records each person's department and position.
 */

type Tone = "board" | "chief" | "primary" | "support" | "cell" | "assurance";

type ChartNode = {
  id: string;
  title: string;
  lines?: string[];
  tone?: Tone;
  /** Department names that place a person here. */
  departments?: RegExp;
  /** Position / job title that places a person here. */
  roles?: RegExp;
  /** Every current person (the group as a whole). */
  everyone?: boolean;
  /** Role that marks the lead; otherwise whoever sits highest on the reporting lines. */
  lead?: RegExp;
  /** Plain-English version of the rule, shown in the panel. */
  basis: string;
  children?: ChartNode[];
  /** Children drawn as a compact list inside the box instead of as boxes below it. */
  listChildren?: boolean;
};

const roleOf = (row: RegisterRow) => row.position_name || row.job_title || "";

// ── Chart 1: group structure ─────────────────────────────────────────────────────
const GROUP_CHART: ChartNode = {
  id: "g-group", title: "SNC Group", tone: "chief", everyone: true,
  lead: /managing director|chief executive|\bceo\b/i, basis: "Everyone currently employed",
  children: [
    {
      id: "g-commercial", title: "Commercial", tone: "primary", departments: /commercial/i,
      lead: /commercial (director|manager)|head of commercial|executive director/i, basis: "Department: Commercial",
      children: [
        {
          id: "g-readymix", title: "Ready-Mix", tone: "support", listChildren: true,
          departments: /ready.?mix|concrete|batch/i, roles: /concrete|batch|ready.?mix|pump/i,
          lead: /(ready.?mix|plant|batch).*(manager|supervisor)/i, basis: "Department: Ready-Mix, or a concrete, batching or pumping role",
          children: [
            { id: "g-rm-concrete", title: "Concrete", roles: /concrete|batch/i, basis: "Concrete or batching roles" },
            { id: "g-rm-pumping", title: "Pumping", roles: /pump/i, basis: "Pump roles" },
            { id: "g-rm-distribution", title: "Distribution", roles: /mixer|distribution|dispatch|delivery/i, basis: "Mixer truck, dispatch and delivery roles" },
            { id: "g-rm-testing", title: "Testing", roles: /lab|test|quality|qc\b/i, basis: "Laboratory, testing and quality roles" },
          ],
        },
        {
          id: "g-plant", title: "Plant & Equipment", tone: "support", listChildren: true,
          departments: /plant|equipment|fleet|workshop/i, roles: /plant|mechanic|operator|fleet|workshop/i,
          lead: /(plant|fleet|workshop).*(manager|supervisor|foreman)/i, basis: "Department: Plant & Equipment, or a plant, mechanic or operator role",
          children: [
            { id: "g-pe-excavators", title: "Excavators", roles: /excavator/i, basis: "Excavator operators" },
            { id: "g-pe-loaders", title: "Loaders", roles: /loader|tlb/i, basis: "Loader and TLB operators" },
            { id: "g-pe-trucks", title: "Trucks", roles: /truck|driver|tipper/i, basis: "Truck and tipper drivers" },
            { id: "g-pe-compaction", title: "Compaction", roles: /compact|roller/i, basis: "Compaction and roller operators" },
          ],
        },
      ],
    },
    {
      id: "g-construction", title: "Construction", tone: "primary", departments: /construction/i,
      lead: /construction (director|manager)|contracts manager|project manager/i, basis: "Department: Construction",
      children: [
        { id: "g-build", title: "Build", tone: "support", roles: /build|brick|mason|carpent|plumb|electric|painter|general hand|foreman/i, basis: "Building trades, foremen and general hands", lead: /foreman|site manager/i },
        { id: "g-civils", title: "Civils", tone: "support", roles: /civil|engineer/i, basis: "Civil and site engineers", lead: /senior|principal|lead/i },
        { id: "g-infra", title: "Infrastructure", tone: "support", departments: /infrastructure/i, roles: /infrastructure|road|water|sewer|structural/i, basis: "Infrastructure, roads, water and structural roles" },
      ],
    },
    {
      id: "g-risk", title: "Risk", tone: "assurance", departments: /risk|audit|compliance/i, roles: /risk|audit|compliance|she\b|hse|safety/i,
      lead: /(risk|audit|compliance).*(manager|head|officer)/i, basis: "Risk, audit, compliance and safety roles",
    },
  ],
};

// ── Chart 2: management structure (drawn as tiers on a central spine) ───────────
const BOARD: ChartNode = {
  id: "m-board", title: "Board of Directors", lines: ["Ownership", "governance", "reserved matters"], tone: "board",
  roles: /board|chair|non.?executive|shareholder/i, lead: /chair/i, basis: "Board, chair and non-executive roles",
};
const CEO: ChartNode = {
  id: "m-ceo", title: "Chief Executive Officer", lines: ["P&L", "execution", "enterprise authority"], tone: "chief",
  roles: /managing director|chief executive|\bceo\b/i, lead: /managing director|chief executive|\bceo\b/i, basis: "Managing Director / Chief Executive",
};
const RISK: ChartNode = {
  id: "m-risk", title: "Risk & Control", lines: ["Independent assurance", "audit"], tone: "assurance",
  departments: /risk|audit|compliance/i, roles: /risk|audit|compliance/i, basis: "Risk, audit and compliance roles. Reports to the Board.",
};
const TIERS: ChartNode[][] = [
  [
    { id: "m-ed", title: "Executive Director", lines: ["Business development", "technical strategy"], tone: "primary", roles: /executive director|business development/i, lead: /executive director/i, basis: "Executive Director and business development roles" },
    { id: "m-commercial", title: "Commercial", lines: ["Tenders", "QS", "contracts"], tone: "primary", departments: /commercial/i, lead: /commercial (director|manager)|head of commercial|procurement manager/i, basis: "Department: Commercial" },
    { id: "m-construction", title: "Construction", lines: ["Projects", "sites", "HSE"], tone: "primary", departments: /construction/i, lead: /construction (director|manager)|contracts manager|project manager/i, basis: "Department: Construction" },
    { id: "m-plant", title: "Plant & Equipment", lines: ["Fleet", "maintenance", "recovery"], tone: "primary", departments: /plant|equipment|fleet|workshop/i, roles: /plant|mechanic|fleet|workshop/i, lead: /(plant|fleet|workshop).*(manager|supervisor)/i, basis: "Department: Plant & Equipment, or a plant, mechanic or fleet role" },
  ],
  [
    { id: "m-finance", title: "Finance", lines: ["Treasury", "accounts", "reporting"], tone: "support", departments: /finance|accounts/i, roles: /financ|account|treasur|bookkeep|payroll/i, lead: /finance (director|manager)|financial controller|cfo/i, basis: "Department: Finance, or a finance, accounts or payroll role" },
    { id: "m-people", title: "People & Admin", lines: ["Contracts", "records", "capability"], tone: "support", departments: /\bhr\b|human|people|admin/i, roles: /\bhr\b|human resource|people|admin|receptionist|front desk|office/i, lead: /(hr|human resources|people|admin).*(manager|head|director)/i, basis: "Department: HR / Admin, or an HR, admin or front-desk role" },
    { id: "m-cio", title: "AEGIS / CIO", lines: ["Workflow", "evidence", "analytics"], tone: "support", departments: /\bit\b|information|systems|aegis|digital/i, roles: /\bcio\b|information|\bit\b|systems|aegis|data|developer|digital/i, lead: /\bcio\b|chief information|systems (manager|lead)/i, basis: "IT, systems, data and AEGIS roles" },
  ],
  [
    { id: "m-delivery", title: "Project Delivery Cells", lines: ["Project manager", "site engineer", "agent"], tone: "cell", roles: /project manager|site (engineer|agent|manager)|engineer|foreman|agent/i, lead: /project manager/i, basis: "Project managers, engineers, site agents and foremen" },
    { id: "m-commercial-cells", title: "Commercial Control Cells", lines: ["QS", "estimator", "procurement"], tone: "cell", roles: /quantity surveyor|\bqs\b|estimat|procurement|buyer/i, lead: /procurement manager|senior (qs|quantity)/i, basis: "QS, estimating and procurement roles" },
    { id: "m-shared", title: "Shared Services", lines: ["Finance", "HR", "documents"], tone: "cell", roles: /financ|account|\bhr\b|human resource|document|records|admin|receptionist|front desk/i, lead: /finance manager|hr manager/i, basis: "Finance, HR, admin and document-control roles" },
  ],
];

const TONE_CLASS: Record<Tone, string> = {
  board: "border-paper/30 bg-void text-paper",
  chief: "border-red-500/60 bg-red-950/50 text-paper",
  primary: "border-signal/40 bg-ink-high text-paper",
  support: "border-slate bg-ink-light text-paper",
  cell: "border-ink-mid bg-ink text-paper",
  assurance: "border-amber-400/70 bg-amber-950/30 text-paper",
};

// ── Membership ──────────────────────────────────────────────────────────────────

function membersOf(node: ChartNode, rows: RegisterRow[]) {
  if (node.everyone) return rows;
  return rows.filter((row) =>
    (node.departments && row.department_name && node.departments.test(row.department_name))
    || (node.roles && node.roles.test(roleOf(row))));
}

function leadOf(node: ChartNode, members: RegisterRow[]) {
  if (!members.length) return null;
  if (members.length === 1) return members[0];
  if (node.lead) {
    const named = members.find((m) => node.lead!.test(roleOf(m)));
    if (named) return named;
  }
  // Otherwise the person in the box whose own manager is outside it and who manages the most people in it.
  const ids = new Set(members.map((m) => m.id));
  const reportsIn = (id: string) => members.filter((m) => m.line_manager_id === id).length;
  const tops = members.filter((m) => !m.line_manager_id || !ids.has(m.line_manager_id));
  const ranked = [...tops].sort((a, b) => reportsIn(b.id) - reportsIn(a.id));
  return ranked[0] && reportsIn(ranked[0].id) > 0 ? ranked[0] : null;
}

// ── Drawing ─────────────────────────────────────────────────────────────────────

const LINE = "bg-slate";

function Box({ node, count, selected, onSelect, wide }: {
  node: ChartNode; count: number; selected: boolean; onSelect: (n: ChartNode) => void; wide?: boolean;
}) {
  const tone = TONE_CLASS[node.tone ?? "support"];
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className={`relative ${wide ? "w-60" : "w-44"} rounded-lg border px-3 py-2.5 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-signal ${tone} ${selected ? "ring-2 ring-signal" : ""}`}
    >
      <div className="text-[13px] font-bold uppercase tracking-wide">{node.title}</div>
      {node.lines && <div className="mt-1 space-y-0.5 text-[11px] leading-tight text-slate-light">{node.lines.map((l) => <div key={l}>{l}</div>)}</div>}
      <div className="mt-2 inline-flex items-center gap-1 rounded-sm border border-slate/30 px-1.5 text-[10px] text-slate-light">
        <Users className="h-3 w-3" />{count} {count === 1 ? "person" : "people"}
      </div>
    </button>
  );
}

/** Children laid out in a row, joined to the parent by a bar and a stub on each. */
function Row({ items, through }: { items: ReactNode[]; through?: boolean }) {
  return (
    <div className="relative flex justify-center">
      {through && <span className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 ${LINE}`} />}
      {items.map((item, i) => (
        <div key={i} className="relative flex flex-col items-center px-2 pt-5">
          {items.length > 1 && i > 0 && <span className={`absolute left-0 top-0 h-px w-1/2 ${LINE}`} />}
          {items.length > 1 && i < items.length - 1 && <span className={`absolute right-0 top-0 h-px w-1/2 ${LINE}`} />}
          <span className={`absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 ${LINE}`} />
          <div className="relative z-10">{item}</div>
        </div>
      ))}
    </div>
  );
}

const Stub = ({ h = "h-6" }: { h?: string }) => <span className={`mx-auto block w-px ${h} ${LINE}`} />;

type DrawProps = { count: (n: ChartNode) => number; selectedId: string | null; onSelect: (n: ChartNode) => void };

function TreeNode({ node, ...p }: { node: ChartNode } & DrawProps) {
  if (node.listChildren && node.children) {
    return (
      <div className="flex flex-col items-center">
        <Box node={node} count={p.count(node)} selected={p.selectedId === node.id} onSelect={p.onSelect} />
        <Stub h="h-3" />
        <ul className="w-44 space-y-1 rounded-md border border-ink-mid bg-ink/60 p-1.5">
          {node.children.map((c) => (
            <li key={c.id}>
              <button
                type="button" onClick={() => p.onSelect(c)}
                className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-xs text-paper hover:bg-ink-mid/40 ${p.selectedId === c.id ? "bg-signal/15 text-signal" : ""}`}
              >
                <span>{c.title}</span><span className="text-[10px] text-slate-light">{p.count(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center">
      <Box node={node} count={p.count(node)} selected={p.selectedId === node.id} onSelect={p.onSelect} wide={node.everyone} />
      {node.children?.length ? (<><Stub h="h-5" /><Row items={node.children.map((c) => <TreeNode key={c.id} node={c} {...p} />)} /></>) : null}
    </div>
  );
}

function GroupChart(p: DrawProps) {
  return <div className="inline-block min-w-full px-6 py-6"><TreeNode node={GROUP_CHART} {...p} /></div>;
}

function ManagementChart(p: DrawProps) {
  const box = (n: ChartNode, wide = false) => <Box key={n.id} node={n} count={p.count(n)} selected={p.selectedId === n.id} onSelect={p.onSelect} wide={wide} />;
  return (
    <div className="inline-block min-w-full px-6 py-6">
      <div className="flex flex-col items-center">
        {box(BOARD, true)}
        <Stub h="h-10" />
        <div className="relative">
          {box(CEO, true)}
          {/* Risk & Control sits beside the CEO, independent, with a dotted line to the Board. */}
          <div className="absolute left-full top-1/2 flex -translate-y-1/2 items-center">
            <span className="block w-10 border-t border-dashed border-amber-400/70" />
            {box(RISK)}
          </div>
        </div>
        <Stub h="h-6" />
        <div className="relative">
          {TIERS.map((tier, i) => (
            <div key={i} className="relative">
              {i > 0 && <Stub h="h-6" />}
              <Row items={tier.map((n) => box(n))} through={i < TIERS.length - 1 && tier.length % 2 === 0} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────────

function NodePanel({ node, members, lead, onClose, onOpenPerson }: {
  node: ChartNode; members: RegisterRow[]; lead: RegisterRow | null; onClose: () => void; onOpenPerson: (id: string) => void;
}) {
  const others = members.filter((m) => m.id !== lead?.id).sort((a, b) => a.employee_name.localeCompare(b.employee_name));
  const person = (m: RegisterRow) => (
    <button key={m.id} type="button" onClick={() => onOpenPerson(m.id)} className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left hover:bg-ink-mid/30">
      <span className="min-w-0">
        <span className="block truncate text-sm text-paper">{m.employee_name}</span>
        <span className="block truncate text-xs text-slate-light">{roleOf(m) || "Role not set"}{m.department_name ? ` · ${m.department_name}` : ""}</span>
      </span>
      {m.employee_number && <span className="shrink-0 font-mono text-[10px] text-slate">{m.employee_number}</span>}
    </button>
  );
  return (
    <aside className="rounded-lg border border-ink-mid bg-ink-light p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold uppercase tracking-wide text-paper">{node.title}</h3>
          <p className="mt-0.5 text-xs text-slate">Placed here by: {node.basis}</p>
        </div>
        <button type="button" onClick={onClose} className="text-slate hover:text-paper" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <h4 className="mb-1 font-mono text-[11px] uppercase tracking-wider text-slate">Lead</h4>
      {lead ? (
        <div className="mb-4 rounded-md border border-signal/40 bg-signal/5 p-1">
          <div className="flex items-center gap-1 px-2 pt-1 text-[10px] uppercase tracking-wider text-signal"><Crown className="h-3 w-3" />Lead</div>
          {person(lead)}
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-light">No lead identified. Set the lead&apos;s position, or make the others report to them.</p>
      )}
      <h4 className="mb-1 font-mono text-[11px] uppercase tracking-wider text-slate">People ({others.length})</h4>
      {others.length ? <div className="max-h-[28rem] overflow-y-auto">{others.map(person)}</div>
        : <p className="text-sm text-slate-light">Nobody else here yet. Set a person&apos;s department or position on their card to place them.</p>}
    </aside>
  );
}

export function OrgStructureChart({ chart }: { chart: "group" | "management" }) {
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ChartNode | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await getPeopleRegister({ status: "current" })).data);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "People could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelected(null); }, [chart]);

  const members = useCallback((n: ChartNode) => membersOf(n, rows), [rows]);

  if (loading && !rows.length) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-signal" /></div>;

  const draw: DrawProps = { count: (n) => members(n).length, selectedId: selected?.id ?? null, onSelect: setSelected };
  const selectedMembers = selected ? members(selected) : [];

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-sm border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
      <p className="text-sm text-slate-light">Click any box to see its lead and the people in it. People are placed by their department and position, so keep those up to date on each person&apos;s card.</p>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="overflow-x-auto rounded-lg border border-ink-mid bg-ink-light/40">
          {chart === "group" ? <GroupChart {...draw} /> : <ManagementChart {...draw} />}
        </section>
        {selected ? (
          <NodePanel node={selected} members={selectedMembers} lead={leadOf(selected, selectedMembers)} onClose={() => setSelected(null)} onOpenPerson={setOpenId} />
        ) : (
          <aside className="hidden rounded-lg border border-dashed border-ink-mid p-4 text-sm text-slate xl:block">Select a box on the chart to list its people here.</aside>
        )}
      </div>
      {openId && <PersonCardModal employeeId={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} initialTab="employment" />}
    </div>
  );
}
