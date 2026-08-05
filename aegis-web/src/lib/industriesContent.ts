// Differentiated editorial content per industry sector, keyed by the slug
// generated in industries/[slug]/page.tsx (name.toLowerCase()). Editorial
// copy, not fetched data - same rationale as lib/capabilitiesContent.ts.
export interface IndustryContent {
  expertise: string;
  challenges: string[];
  regulatory: string;
  relatedCapabilities: string[];
}

export const INDUSTRIES_CONTENT: Record<string, IndustryContent> = {
  mining: {
    expertise:
      "Mining sector work happens inside live operations — access roads, plant civils, and support infrastructure built around production schedules that can't stop for construction. SNC sequences civil and structural work jointly with the mine's own operations team rather than treating it as an interruption to be worked around.",
    challenges: [
      "Sequencing construction around blast-exclusion windows and live haul road traffic.",
      "Executing brownfield civils adjacent to operating plant without disrupting throughput.",
      "Managing remote-site logistics and supply chains far from established infrastructure.",
      "Ground conditions that shift construction methodology from what was originally scoped.",
    ],
    regulatory:
      "Mining infrastructure work in Zimbabwe sits under EMA environmental compliance, mine safety regulations, and site-specific operational permits layered on top of standard construction requirements. Our teams are inducted to each site's own safety and access protocols before mobilisation.",
    relatedCapabilities: ["Mining Infrastructure", "Earthworks & Grading", "Heavy Plant Operations", "Project Controls"],
  },
  government: {
    expertise:
      "Public infrastructure work carries a different discipline to private-sector construction — procurement compliance, audit scrutiny, and multi-stakeholder coordination are part of the delivery, not overhead around it. SNC holds PRAZ Category A classification and structures project controls around public accountability from day one.",
    challenges: [
      "Meeting public procurement and tender compliance requirements at every stage.",
      "Coordinating across multiple government stakeholders and approval bodies.",
      "Operating within fixed public budgets with formal audit and reporting obligations.",
      "Extended approval cycles that require programme resilience, not just speed.",
    ],
    regulatory:
      "Government infrastructure contracts are governed by PRAZ procurement regulations and the Public Finance Management Act, alongside the same EMA and municipal building requirements that apply to any construction project. Our project controls function tracks compliance and reporting obligations alongside programme and cost.",
    relatedCapabilities: ["Civil Infrastructure", "Project Controls", "Design & Build", "Structural Engineering"],
  },
  commercial: {
    expertise:
      "Commercial construction runs on a tenant's own opening date, not a construction-industry timeline — corporate offices, retail, and mixed-use developments need finish quality and programme certainty in equal measure. SNC locks the design freeze early and runs structural and finishing trades in parallel wherever the sequence allows.",
    challenges: [
      "Meeting fixed handover dates tied to a tenant's own occupancy schedule.",
      "Coordinating MEP services routing through a compressed structural sequence.",
      "Holding commercial-grade finish tolerances that industrial work doesn't require.",
      "Urban site access and laydown constraints in built-up locations.",
    ],
    regulatory:
      "Commercial developments are subject to municipal building codes, occupancy certification, and fire/life-safety compliance specific to the building's end use. We coordinate certification requirements into the programme rather than treating them as a post-handover step.",
    relatedCapabilities: ["Commercial Construction", "Structural Engineering", "Design & Build", "Project Controls"],
  },
  industrial: {
    expertise:
      "Industrial and manufacturing facilities are engineered around the process they house — floor loading, equipment foundations, and commissioning sequencing all have to be right before the plant can run. SNC coordinates structural design directly against process equipment specifications rather than generic industrial-building assumptions.",
    challenges: [
      "Structural design driven by heavy process-equipment floor loading, not standard live loads.",
      "Coordinating civil and structural sequencing against equipment delivery and installation.",
      "Commissioning-stage handover that has to align with production start-up dates.",
      "Integrating safety systems required for the specific industrial process, not generic code minimums.",
    ],
    regulatory:
      "Industrial facilities carry EMA environmental compliance and occupational safety and health requirements specific to the manufacturing process involved, layered onto standard structural and building code compliance.",
    relatedCapabilities: ["Structural Engineering", "Heavy Plant Operations", "Civil Infrastructure", "Project Controls"],
  },
  energy: {
    expertise:
      "Energy-sector civil works — substation foundations, solar farm grading, transmission grid anchor works — happen adjacent to live electrical infrastructure, where an access or sequencing mistake has consequences beyond the construction programme. SNC plans work around outage-window scheduling set by the utility, not the construction schedule.",
    challenges: [
      "Working safely adjacent to live electrical infrastructure with no margin for error.",
      "Scheduling civil works around utility-controlled outage windows, not project convenience.",
      "Specialised foundation design for substation and transmission-grid loading.",
      "Remote site access for solar and grid infrastructure often far from urban supply chains.",
    ],
    regulatory:
      "Energy infrastructure work is governed by utility and grid-operator technical standards alongside EMA environmental compliance, with site-specific safety protocols required for work near live electrical assets.",
    relatedCapabilities: ["Civil Infrastructure", "Earthworks & Grading", "Structural Engineering", "Project Controls"],
  },
  transport: {
    expertise:
      "Transport infrastructure — highways, bridges, transit corridors — is delivered at a scale measured in kilometres, often while traffic keeps moving through the work zone. SNC manages live-traffic staging and drainage design as core engineering decisions, not afterthoughts to the paving programme.",
    challenges: [
      "Staging construction around live traffic without closing critical routes.",
      "Drainage and hydrology design across long, variable-terrain corridors.",
      "Programme exposure to multiple wet seasons on multi-year corridor projects.",
      "Milestone-gated funding disbursement tied to government infrastructure budgets.",
    ],
    regulatory:
      "Road and transport infrastructure work follows road authority design and construction standards alongside EMA environmental compliance for corridor and drainage works.",
    relatedCapabilities: ["Civil Infrastructure", "Earthworks & Grading", "Heavy Plant Operations", "Project Controls"],
  },
  agriculture: {
    expertise:
      "Agricultural infrastructure — irrigation networks, storage silos, processing facilities — is built around planting and harvest cycles, not a construction-industry calendar. SNC sequences civil works to fit the agricultural season the facility needs to be ready for, not the other way around.",
    challenges: [
      "Construction windows constrained by planting and harvest seasonality.",
      "Remote rural site logistics with limited local supply chain infrastructure.",
      "Water-resource management compliance for irrigation and reservoir works.",
      "Storage capacity engineering matched to real harvest volumes, not generic sizing.",
    ],
    regulatory:
      "Agricultural infrastructure work involves EMA water-use permits for irrigation and reservoir works, alongside standard structural compliance for storage and processing facilities.",
    relatedCapabilities: ["Civil Infrastructure", "Earthworks & Grading", "Structural Engineering", "Project Controls"],
  },
  infrastructure: {
    expertise:
      "Municipal and urban infrastructure — water networks, utility corridors, civic facilities — usually means tying new work into an existing live network without interrupting the service it already provides. SNC coordinates directly with the relevant utility and municipal authority rather than treating tie-ins as a late-stage risk.",
    challenges: [
      "Tying into live water and utility networks without service interruption.",
      "Coordinating across multiple utility agencies with independent approval processes.",
      "Urban site access and staging constraints in built-up municipal areas.",
      "Integrating new infrastructure with ageing existing networks of unknown condition.",
    ],
    regulatory:
      "Municipal infrastructure work follows local authority utility standards and EMA environmental compliance, with tie-in works requiring sign-off from the relevant utility operator before connection.",
    relatedCapabilities: ["Civil Infrastructure", "Structural Engineering", "Project Controls", "Design & Build"],
  },
};

export function getIndustryContent(slug: string): IndustryContent {
  return (
    INDUSTRIES_CONTENT[slug] ?? {
      expertise:
        "SNC delivers this sector's infrastructure with the same engineering-led, safety-first approach applied across every discipline we operate in.",
      challenges: [
        "Site-specific operational constraints shaped by the sector's own requirements.",
        "Coordinating construction sequencing around live operations where relevant.",
        "Regulatory and compliance requirements specific to the sector.",
        "Programme delivery matched to the sector's own operational calendar.",
      ],
      regulatory:
        "Work in this sector is delivered in line with the relevant regulatory and compliance frameworks that apply, alongside SNC's standard construction and safety standards.",
      relatedCapabilities: ["Civil Infrastructure", "Structural Engineering", "Project Controls", "Design & Build"],
    }
  );
}
