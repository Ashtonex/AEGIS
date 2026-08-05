// Differentiated editorial content per capability, keyed by the slug
// generated in capabilities/[slug]/page.tsx (name.toLowerCase().replace(" & ", "-").replace(/\s+/g, "-")).
// This is authored copy, not fetched data - capability write-ups are
// editorial content, not something a backend API meaningfully serves.
export interface CapabilityContent {
  statement: string;
  challenge: string;
  approach: string;
  breakdown: string[];
}

export const CAPABILITIES_CONTENT: Record<string, CapabilityContent> = {
  "civil-infrastructure": {
    statement:
      "Civil infrastructure is the foundation discipline underneath everything else SNC delivers — roads, drainage, earthworks, and the primary civil scope that every other trade builds on top of.",
    challenge:
      "Civil works in Zimbabwe run against variable subgrade conditions, seasonal rainfall windows that compress the workable construction calendar, and haul-route logistics across sites that are often remote from established supply chains.",
    approach:
      "We front-load geotechnical investigation before pricing, sequence earthworks around the wet season rather than around it, and keep compaction, materials, and survey control under one contract so there's no interface risk between subcontractors.",
    breakdown: [
      "Geotechnical investigation and subgrade characterization ahead of design.",
      "Bulk earthworks, cut-to-fill balancing, and haul road management.",
      "Stormwater drainage, culverts, and erosion control structures.",
      "Road base construction, compaction testing, and surfacing.",
      "Survey control and as-built verification through project close-out."
    ]
  },
  "mining-infrastructure": {
    statement:
      "Mining infrastructure work sits inside live operational sites — access roads, plant civils, and support infrastructure built around production schedules that don't stop for construction.",
    challenge:
      "The core constraint is sequencing construction activity around an operating mine: shared haul roads, blast-exclusion windows, and safety inductions that add real time to every mobilisation.",
    approach:
      "We plan civil and structural sequencing jointly with the mine's own operations team from the outset, so our access, laydown, and work windows are agreed rather than negotiated on the fly once we're on site.",
    breakdown: [
      "Access road and haul road construction to mine-spec loading standards.",
      "Plant-area civils: foundations, hardstands, and containment structures.",
      "Coordination with live blast schedules and operational exclusion zones.",
      "Site-specific safety induction and permit-to-work compliance.",
      "Support infrastructure: workshops, laydown areas, and site services."
    ]
  },
  "commercial-construction": {
    statement:
      "Commercial construction covers ground-up and refurbishment work for retail, office, and institutional clients where programme certainty and finish quality both matter to the end tenant.",
    challenge:
      "Commercial projects carry tighter finish tolerances than industrial work and usually run on a fixed handover date tied to a tenant's own opening schedule, which leaves little room for float once the programme is set.",
    approach:
      "We lock the design freeze early, procure long-lead finishes ahead of the critical path, and run structural and finishing trades in parallel wherever the sequence allows, rather than treating fit-out as a separate phase that starts after shell completion.",
    breakdown: [
      "Structural shell construction: foundations, frame, and envelope.",
      "MEP coordination and services routing through the structural sequence.",
      "Interior fit-out and finishes to commercial tolerance standards.",
      "Long-lead material procurement tracked against the critical path.",
      "Handover documentation and defects-liability period management."
    ]
  },
  "structural-engineering": {
    statement:
      "Structural engineering is the discipline behind every load path on an SNC site — from foundation design through to the frame that carries it, engineered rather than assumed.",
    challenge:
      "Structural risk shows up long before construction starts: undocumented ground conditions, load assumptions carried over from a different site, or a design that wasn't checked against actual site geotechnical data.",
    approach:
      "We tie structural design to site-specific geotechnical data rather than regional assumptions, and keep structural review inside the same team that will execute the build, so design intent doesn't get lost in translation on site.",
    breakdown: [
      "Foundation design informed by site-specific geotechnical investigation.",
      "Structural frame design and independent load-path verification.",
      "Reinforced concrete detailing and structural steel connections.",
      "Construction-stage structural review and site inspection.",
      "As-built structural certification for handover."
    ]
  },
  "earthworks-grading": {
    statement:
      "Earthworks and grading is bulk-volume work — moving, shaping, and compacting ground to design levels ahead of everything that gets built on top of it.",
    challenge:
      "Earthmoving economics are driven by haul distance and cut-to-fill balance; getting that balance wrong on a large site turns into real cost and programme exposure before any structure is even priced.",
    approach:
      "We model cut-to-fill balance and haul routes during estimating, not after mobilisation, and run our own owned fleet on the bulk-volume work so plant availability doesn't become the constraint on programme.",
    breakdown: [
      "Cut-to-fill volume modelling and haul route planning.",
      "Bulk excavation and material placement to design levels.",
      "Compaction to specified density with field testing verification.",
      "Site grading and drainage fall for finished platforms.",
      "Owned plant fleet deployment — no third-party hire dependency."
    ]
  },
  "heavy-plant-operations": {
    statement:
      "Heavy plant operations is the equipment and operator capacity behind SNC's earthworks, mining, and civil scopes — owned assets, not rented availability.",
    challenge:
      "Plant-dependent programmes are only as reliable as equipment uptime; hired plant introduces a dependency on a third party's maintenance schedule and availability that sits outside the contractor's control.",
    approach:
      "We own and maintain our own fleet through our plant division, which means preventive maintenance is scheduled around our own programme rather than a hire company's fleet-wide utilisation targets.",
    breakdown: [
      "Owned fleet: excavators, articulated dump trucks, graders, and compactors.",
      "In-house preventive maintenance and workshop support.",
      "Operator certification and equipment-specific competency verification.",
      "Fleet allocation planning across concurrent site demands.",
      "Utilisation and downtime tracking through Project AEGIS."
    ]
  },
  "project-controls": {
    statement:
      "Project controls is the reporting and cost-tracking discipline that keeps every other capability accountable to programme and budget, not a separate service layered on top.",
    challenge:
      "On multi-trade sites, cost and schedule visibility usually lags site reality by weeks — by the time a variance shows up in a report, the cost has already been committed on site.",
    approach:
      "We run cost codes, progress claims, and schedule tracking through the same system site teams use day to day, so variance shows up close to when it happens rather than at the next reporting cycle.",
    breakdown: [
      "Cost code structuring and budget baseline management.",
      "Progress claim preparation and variation tracking.",
      "Schedule development, critical-path tracking, and float management.",
      "Weekly site-to-office reporting through Project AEGIS.",
      "Risk register maintenance and early-warning variance flagging."
    ]
  },
  "design-build": {
    statement:
      "Design & build puts design and construction responsibility under one contract, so the team that has to build it is involved in the decisions that determine whether it's buildable.",
    challenge:
      "Split design-and-build contracts push constructability risk onto whoever holds the construction contract, without giving them any say in the design decisions that created that risk.",
    approach:
      "We involve our own construction team in design review before drawings are frozen, so buildability, sequencing, and cost are considered alongside the design intent rather than discovered after award.",
    breakdown: [
      "Single point of accountability across design and construction.",
      "Constructability review during design development, not after freeze.",
      "Integrated cost planning tied to design decisions in real time.",
      "Coordinated design-to-construction handover with no re-scoping gap.",
      "Value engineering assessed against buildability, not just cost."
    ]
  }
};

export function getCapabilityContent(slug: string): CapabilityContent {
  return (
    CAPABILITIES_CONTENT[slug] ?? {
      statement:
        "SNC delivers this capability with the same engineering-led, safety-first approach applied across every discipline we operate in.",
      challenge:
        "Every project brings its own site conditions, programme constraints, and stakeholder requirements that shape how this capability is delivered.",
      approach:
        "Our project teams apply Project AEGIS for real-time visibility into progress, cost, and risk, so issues are addressed before they affect the critical path.",
      breakdown: [
        "Site-specific planning informed by direct investigation, not assumption.",
        "Owned plant and equipment deployed where it reduces schedule risk.",
        "Quality assurance and materials testing to specification.",
        "Real-time progress tracking through Project AEGIS.",
        "Direct engineering oversight from mobilisation to handover."
      ]
    }
  );
}
