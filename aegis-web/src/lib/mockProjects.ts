import { ProjectCategory, Industry, ProjectStatus } from "@/types/website";

export interface SubProjectDetail {
  id: string;
  title: string;
  status: ProjectStatus;
  budget: string;
  value: number;
  duration: string;
  scopeSummary: string;
  challenge: string;
  approach: string;
  outcomes: string[];
  gallery: string[];
}

export interface ProjectDetail {
  id: string;
  slug: string;
  title: string;
  client: string;
  sector: string;
  status: ProjectStatus;
  budget: string; // for list view
  value: number; // for detail view
  duration: string;
  scope: string; // short summary
  image: string; // image path
  grid: string; // grid placement on list view
  category: ProjectCategory;
  industry: Industry;
  province: string;
  contractType: string;
  timeline: { start: string; end?: string };
  scopeSummary: string;
  challenge: string;
  approach: string;
  outcomes: string[];
  gallery: string[];
  documents: { title: string; url: string; type: string }[];
  subProjects?: SubProjectDetail[];
}

export const MOCK_PROJECTS: ProjectDetail[] = [
  {
    id: "SNC-KARIBA",
    slug: "kariba",
    title: "Kariba Dam Rehabilitation",
    client: "Zambezi River Authority (ZRA)",
    sector: "Civil Infrastructure",
    status: "Active",
    budget: "USD 294M",
    value: 294000000,
    duration: "68 months",
    scope: "Plunge pool shaping, structural stabilization, and spillway gate refurbishment",
    image: "/projects_assets/other_civil/img_1.webp",
    grid: "lg:col-span-12 lg:row-span-2",
    category: "Civil Infrastructure",
    industry: "Energy",
    province: "Mashonaland West",
    contractType: "EPC",
    timeline: { start: "2021-03-01", end: "2026-12-31" },
    scopeSummary: "Full underwater concrete placement, plunge pool shaping, high-tensile rock anchoring, and refurbishment of the spillway control gates.",
    challenge: "Executing massive underwater concrete pours in high-velocity flows without interrupting power generation for Zimbabwe and Zambia.",
    approach: "SNC deployed specialized deep-water dive teams and advanced cofferdam designs to redirect flows, utilizing real-time sensor networks for structural integrity monitoring.",
    outcomes: [
      "Plunge pool stabilization 75% complete.",
      "Zero safety incidents in high-risk zones over 1.5M man-hours.",
      "Successful installation of major cofferdam structure."
    ],
    gallery: ["/proj-bridge.jpg"],
    documents: [{ title: "Project Overview Document", url: "#", type: "pdf" }],
    subProjects: []
  },
  {
    id: "SNC-MEGA-MARKET",
    slug: "mega-market",
    title: "Mega Market Logistics & Industrial Program",
    client: "Mega Market",
    sector: "Industrial & Logistics Infrastructure",
    status: "Completed",
    budget: "USD 25.1M",
    value: 20050000,
    duration: "72 months",
    scope: "Turnkey delivery of warehouses, offices, milling plants, transport yards, drainage, and retaining infrastructure.",
    image: "/projects_assets/mm_transport_yard/img_1.webp",
    grid: "lg:col-span-7 lg:row-span-2",
    category: "Industrial Infrastructure",
    industry: "Industrial",
    province: "Harare",
    contractType: "Design & Build",
    timeline: { start: "2017-10-01", end: "2023-03-15" },
    scopeSummary: "A comprehensive infrastructure development program spanning multiple construction phases, providing Mega Market with high-capacity warehousing, corporate head offices, milling operations, and advanced logistics support facilities.",
    challenge: "Executing multiple major construction projects on active, operating industrial logistics sites without interrupting high-volume operations.",
    approach: "Phased construction schedules, heavy steel prefabrication off-site, and night-shift concrete paving under strict safety and dust-mitigation controls.",
    outcomes: [
      "Successfully handed over 6400sqm and 4500sqm logistics warehouses.",
      "Constructed state-of-the-art wheat and maize milling civil works.",
      "Built low-maintenance interlocking heavy-haulage transport yards.",
      "Delivered modern head office extensions with zero operational interruptions."
    ],
    gallery: ["/snc_industrial_warehouse.png", "/projects_assets/mm_retaining_walls/img_1.webp", "/projects_assets/mm_stormwater/img_1.webp"],
    documents: [],
    subProjects: [
      {
        id: "SNC-MM-WH64",
        title: "6400sqm Warehouse",
        status: "Completed",
        budget: "USD 8.5M",
        value: 8500000,
        duration: "14 months",
        scopeSummary: "Structural steel erection, cladding, installation of industrial-grade polished concrete floor slab, loading docks, and external hardstands.",
        challenge: "Erecting a 24-meter clear-span portal frame with high wind loads during the peak of the rainy season.",
        approach: "Sequential steel assembly using dual mobile cranes and customized temporary wind bracing protocols.",
        outcomes: [
          "Zero wet-weather delays due to preemptive roof sheeting.",
          "Polished concrete slab achieved high flatness tolerance.",
          "Handed over to client ahead of schedule."
        ],
        gallery: Array.from({ length: 15 }, (_, i) => `/projects_assets/mm_retaining_walls/img_${i + 1}.webp`)
      },
      {
        id: "SNC-MM-OBE",
        title: "Office Block Extension",
        status: "Completed",
        budget: "USD 3.2M",
        value: 3200000,
        duration: "12 months",
        scopeSummary: "Reinforced concrete frame construction, internal partition walls, luxury finishing, HVAC integration, and electrical reticulation.",
        challenge: "Constructing adjacent to active, occupied corporate offices with strict noise limitations.",
        approach: "Acoustic shielding, heavy concrete pours scheduled for off-peak hours, and rigorous safety fencing.",
        outcomes: [
          "Completed within budget with zero safety incidents.",
          "Premium finish matching the existing architectural aesthetic.",
          "Minimal disruption to Mega Market operations."
        ],
        gallery: Array.from({ length: 10 }, (_, i) => `/projects_assets/mm_retaining_walls/img_${i + 16}.webp`)
      },
      {
        id: "SNC-MM-WMC",
        title: "Wheat Mill Civils",
        status: "Completed",
        budget: "USD 4.5M",
        value: 4500000,
        duration: "10 months",
        scopeSummary: "Heavy machine foundations, deep intake pit excavation, structural steel support structures, and surface water drainage systems.",
        challenge: "Precision alignment required for large-scale milling machinery foundations (less than 2mm tolerance).",
        approach: "Utilized laser-guided alignment technology and high-performance non-shrink grout under machine bases.",
        outcomes: [
          "Machinery installed with zero alignment modifications required.",
          "Completed 3 weeks ahead of schedule.",
          "High strength concrete foundations exceeding engineering specs."
        ],
        gallery: Array.from({ length: 38 }, (_, i) => `/projects_assets/mm_flour_mill_substation/img_${i + 1}.webp`)
      },
      {
        id: "SNC-MM-TY",
        title: "Transport Yard",
        status: "Completed",
        budget: "USD 1.8M",
        value: 1800000,
        duration: "6 months",
        scopeSummary: "Sub-base stabilization, interlocking concrete block paving suitable for heavy axle loads, stormwater drainage, and oil separators.",
        challenge: "Unsuitable silty soils requiring extensive stabilizing treatment before paving.",
        approach: "In-situ cement stabilization of the subgrade to a depth of 300mm followed by heavy compaction.",
        outcomes: [
          "Achieved target compaction density on all test zones.",
          "Excellent stormwater runoff control.",
          "Durable surface withstanding heavy logistics traffic."
        ],
        gallery: Array.from({ length: 36 }, (_, i) => `/projects_assets/mm_transport_yard/img_${i + 1}.webp`)
      },
      {
        id: "SNC-MM-TYA",
        title: "Transport Yard Ablution",
        status: "Completed",
        budget: "USD 450K",
        value: 450000,
        duration: "4 months",
        scopeSummary: "Construction of modern ablution facilities, including plumbing, waste management, and high-durability finishes for the transport logistics team.",
        challenge: "Integrating facility plumbing into the main municipal lines without interrupting continuous transport yard truck traffic.",
        approach: "Conducted underground directional drilling and scheduled deep sewer connections during off-peak weekend hours.",
        outcomes: [
          "Delivered fully functional and hygienic ablution block.",
          "Zero disruption to yard logistics.",
          "High durability, water-efficient sanitary fittings installed."
        ],
        gallery: Array.from({ length: 13 }, (_, i) => `/projects_assets/mm_transport_ablution/img_${i + 1}.webp`)
      },
      {
        id: "SNC-MM-SD",
        title: "Stormwater Drain",
        status: "Completed",
        budget: "USD 800K",
        value: 800000,
        duration: "5 months",
        scopeSummary: "Excavation and installation of precast concrete culverts, catch basins, and outflow structures to handle heavy stormwater runoff.",
        challenge: "Mitigating erosion risks and managing live surface runoff during torrential seasonal rains.",
        approach: "Utilized rapid-set concrete bedding and phased trenching to secure sections before afternoon downpours.",
        outcomes: [
          "Redirected 100% of seasonal runoff safely.",
          "Prevented yard flooding and subgrade erosion.",
          "Achieved high-capacity discharge compliance."
        ],
        gallery: Array.from({ length: 43 }, (_, i) => `/projects_assets/mm_stormwater/img_${i + 1}.webp`)
      },
      {
        id: "SNC-MM-RW",
        title: "Retaining Walls",
        status: "Completed",
        budget: "USD 650K",
        value: 650000,
        duration: "3 months",
        scopeSummary: "Design and construction of reinforced concrete cantilever retaining walls to stabilize structural terracing for warehouse loading zones.",
        challenge: "Securing steep slopes with high earth pressure adjacent to heavy operational machinery lanes.",
        approach: "Installed deep soil anchors and permanent weeping pipes to relieve hydrostatic pressure behind the wall.",
        outcomes: [
          "Stabilized terrace with zero movement detected.",
          "Safe operation of heavy reach stackers nearby.",
          "Integrates seamlessly with the warehouse perimeter security."
        ],
        gallery: Array.from({ length: 26 }, (_, i) => `/projects_assets/mm_retaining_walls/img_${i + 1}.webp`)
      },
      {
        id: "SNC-MM-PS",
        title: "Pallet Shade",
        status: "Completed",
        budget: "USD 150K",
        value: 150000,
        duration: "2 months",
        scopeSummary: "Foundations, structural steel columns, and corrugated iron roof sheeting for open-sided pallet storage.",
        challenge: "Erecting steel in a busy yard with constant forklift traffic.",
        approach: "Created a dedicated barricaded construction zone and worked early morning hours to erect steel safely.",
        outcomes: [
          "Completed in 6 weeks with zero interference to logistics operations.",
          "Robust protection for stored wooden pallets.",
          "First successful project delivered by SNC for Mega Market."
        ],
        gallery: []
      }
    ]
  },
  {
    id: "SNC-HILLCREST",
    slug: "hillcrest",
    title: "Hillcrest College Hostel Project",
    client: "Hillcrest Schools",
    sector: "Institutional Buildings",
    status: "Completed",
    budget: "USD 2.2M",
    value: 2200000,
    duration: "14 months",
    scope: "Multi-level residential block construction for student housing.",
    image: "/projects_assets/hillcrest/img_1.webp",
    grid: "lg:col-span-5 lg:row-span-1",
    category: "Institutional Buildings",
    industry: "Education",
    province: "Manicaland",
    contractType: "Lump Sum",
    timeline: { start: "2019-11-01", end: "2021-01-01" },
    scopeSummary: "Construction of double-story brick structure, dormitories, common rooms, bathroom blocks, and associated landscaping.",
    challenge: "Covid-19 related lockdowns occurred mid-construction, creating labor and supply shortages.",
    approach: "Sourced locally available materials and housed essential labor force on-site in a secure bubble to continue progress.",
    outcomes: [
      "Delivered with minimal delay despite unprecedented global pandemic conditions.",
      "High quality masonry works.",
      "Provided safe accommodation for returning students."
    ],
    gallery: ["/proj-commercial.jpg", "/projects_assets/hillcrest/img_1.webp"],
    documents: [],
    subProjects: [
      {
        id: "SNC-HC-BHB",
        title: "Boys Hostel Block",
        status: "Completed",
        budget: "USD 2.2M",
        value: 2200000,
        duration: "14 months",
        scopeSummary: "Construction of double-story brick structure, dormitories, common rooms, bathroom blocks, and associated landscaping.",
        challenge: "Covid-19 related lockdowns occurred mid-construction, creating labor and supply shortages.",
        approach: "Sourced locally available materials and housed essential labor force on-site in a secure bubble to continue progress.",
        outcomes: [
          "Delivered with minimal delay despite unprecedented global pandemic conditions.",
          "High quality masonry works.",
          "Provided safe accommodation for returning students."
        ],
        gallery: Array.from({ length: 31 }, (_, i) => `/projects_assets/hillcrest/img_${i + 1}.webp`)
      }
    ]
  },
  {
    id: "SNC-SURREY",
    slug: "surrey",
    title: "Surrey Mutare Depot Development",
    client: "Surrey Mutare Depot",
    sector: "Commercial Construction",
    status: "Completed",
    budget: "USD 250K",
    value: 250000,
    duration: "3 months",
    scope: "Retail space fit-out and commercial depot refurbishment.",
    image: "/projects_assets/surrey_pie_shop/img_1.webp",
    grid: "lg:col-span-4 lg:row-span-1",
    category: "Commercial Construction",
    industry: "Commercial",
    province: "Manicaland",
    contractType: "Lump Sum",
    timeline: { start: "2018-02-01", end: "2018-05-01" },
    scopeSummary: "Interior demolition, retail layout construction, cold room installation, bakery setup, and corporate branding application.",
    challenge: "Tight 3-month window to minimize revenue loss for the depot.",
    approach: "Careful sequencing of trade contractors (plumbers, electricians, and shopfitters) to work in overlapping zones.",
    outcomes: [
      "Completed exactly on the target date.",
      "Modern food-safe environment delivered.",
      "Depot reopened successfully with strong sales."
    ],
    gallery: ["/snc_commercial_office.png", "/projects_assets/surrey_pie_shop/img_1.webp"],
    documents: [],
    subProjects: [
      {
        id: "SNC-SURREY-PSR",
        title: "Surrey Pie Shop Renovations",
        status: "Completed",
        budget: "USD 250K",
        value: 250000,
        duration: "3 months",
        scopeSummary: "Interior demolition, retail layout construction, cold room installation, bakery setup, and corporate branding application.",
        challenge: "Tight 3-month window to minimize revenue loss for the depot.",
        approach: "Careful sequencing of trade contractors (plumbers, electricians, and shopfitters) to work in overlapping zones.",
        outcomes: [
          "Completed exactly on the target date.",
          "Modern food-safe environment delivered.",
          "Depot reopened successfully with strong sales."
        ],
        gallery: Array.from({ length: 15 }, (_, i) => `/projects_assets/surrey_pie_shop/img_${i + 1}.webp`)
      }
    ]
  },
  {
    id: "SNC-TROUTBECK",
    slug: "troutbeck",
    title: "Troutbeck Resort Renovations",
    client: "Troutbeck Resort",
    sector: "Hospitality Renovation",
    status: "Completed",
    budget: "USD 2.8M",
    value: 2800000,
    duration: "18 months",
    scope: "Structural upgrades and premium heritage finishes.",
    image: "/projects_assets/troutbeck/img_1.webp",
    grid: "lg:col-span-4 lg:row-span-1",
    category: "Commercial Construction",
    industry: "Commercial",
    province: "Manicaland",
    contractType: "EPCM",
    timeline: { start: "2020-09-01", end: "2022-03-01" },
    scopeSummary: "Renovation of hotel chalets, public lounges, dining halls, structural reinforcement of historic roofing structures.",
    challenge: "Preserving historical features of the resort while upgrading to modern structural standards.",
    approach: "Detailed cataloging of architectural details and using steel reinforcement concealed within timber beams.",
    outcomes: [
      "Successfully modernized resort infrastructure.",
      "Retained heritage classification and aesthetic charm.",
      "Highly commended by resort management."
    ],
    gallery: ["/proj-commercial.jpg", "/projects_assets/troutbeck/img_1.webp"],
    documents: [],
    subProjects: [
      {
        id: "SNC-TB-TS",
        title: "Timeshares Troutbeck",
        status: "Completed",
        budget: "USD 2.8M",
        value: 2800000,
        duration: "18 months",
        scopeSummary: "Renovation of hotel chalets, public lounges, dining halls, structural reinforcement of historic roofing structures.",
        challenge: "Preserving historical features of the resort while upgrading to modern structural standards.",
        approach: "Detailed cataloging of architectural details and using steel reinforcement concealed within timber beams.",
        outcomes: [
          "Successfully modernized resort infrastructure.",
          "Retained heritage classification and aesthetic charm.",
          "Highly commended by resort management."
        ],
        gallery: Array.from({ length: 22 }, (_, i) => `/projects_assets/troutbeck/img_${i + 1}.webp`)
      }
    ]
  },
  {
    id: "SNC-OTHER-CIVIL",
    slug: "other-civil",
    title: "Other Civil & Private Works",
    client: "Various Clients",
    sector: "Civil Infrastructure",
    status: "Completed",
    budget: "USD 6.4M",
    value: 6420000,
    duration: "Multi-year",
    scope: "Paving, sports courts, container stacking pad, and private refurbishments.",
    image: "/projects_assets/other_civil/img_6.webp",
    grid: "lg:col-span-12 lg:row-span-1",
    category: "Civil Infrastructure",
    industry: "Transport",
    province: "Manicaland",
    contractType: "Lump Sum",
    timeline: { start: "2018-05-01", end: "2020-12-15" },
    scopeSummary: "A portfolio of high-precision civil engineering and private developments, including dry ports, container pads, sports facilities, and housing.",
    challenge: "Managing diverse regulatory, environmental, and spatial constraints across distinct project sites.",
    approach: "Deploying site-specific expert teams and standardized concrete mixing and paving technologies.",
    outcomes: [
      "Delivered container yards and paved ports on specification.",
      "Successfully constructed professional padel sports courts.",
      "All private renovations met client expectations."
    ],
    gallery: ["/snc_civil_yard.png", "/projects_assets/other_civil/img_1.webp"],
    documents: [],
    subProjects: [
      {
        id: "SNC-AU-CP",
        title: "Africa University Container Pad",
        status: "Completed",
        budget: "USD 1.2M",
        value: 1200000,
        duration: "8 months",
        scopeSummary: "Mass excavation, sub-grade stabilization, installation of heavy-duty reinforced concrete pavement, drainage structures, and security perimeter.",
        challenge: "Completing works within a tight schedule during active university semesters with minimal noise and dust disruption.",
        approach: "Phased mobilization and night-shift concrete pouring using low-noise equipment and dust-suppression watering systems.",
        outcomes: [
          "Delivered 100% on schedule.",
          "Achieved high-durability pavement specification (40MPa concrete).",
          "Zero disruption to academic activities."
        ],
        gallery: Array.from({ length: 5 }, (_, i) => `/projects_assets/other_civil/img_${i + 1}.webp`)
      },
      {
        id: "SNC-GMS-DP",
        title: "GMS Dry Port Concrete Paving",
        status: "Completed",
        budget: "USD 3.9M",
        value: 3900000,
        duration: "10 months",
        scopeSummary: "Grading, stabilization, drainage pipes, and 30,000sqm of reinforced concrete paving for shipping containers.",
        challenge: "Extremely heavy loads from reach stackers requiring a concrete pavement depth of 250mm.",
        approach: "Designed a high-strength concrete mix and used heavy-duty mechanical screeds for a uniform surface.",
        outcomes: [
          "Pavement successfully supports heavy machinery without cracking.",
          "Completed within the contracted timeline.",
          "Major enhancement to the region's dry port logistics capability."
        ],
        gallery: Array.from({ length: 5 }, (_, i) => `/projects_assets/other_civil/img_${i + 6}.webp`)
      },
      {
        id: "SNC-PC-PC",
        title: "Padel Court Construction",
        status: "Completed",
        budget: "USD 120K",
        value: 120000,
        duration: "3 months",
        scopeSummary: "Excavation, specialized concrete slab pouring, installation of tempered glass walls, structural steel framing, and professional synthetic turf.",
        challenge: "Achieving perfect slab levelness and vertical glass alignment within sub-millimeter tolerances.",
        approach: "Utilized laser-leveling screeds for concrete pouring and precision anchoring systems for glass panes.",
        outcomes: [
          "Delivered professional-grade padel court.",
          "Perfect glass bounce and structural safety certification.",
          "Turnkey delivery within the active club venue."
        ],
        gallery: Array.from({ length: 15 }, (_, i) => `/projects_assets/padel_court/img_${i + 1}.webp`)
      },
      {
        id: "SNC-PR-RW",
        title: "Private Renovation Works",
        status: "Completed",
        budget: "USD 1.9M",
        value: 1900000,
        duration: "16 months",
        scopeSummary: "Construction and renovation of 12 semi-detached residential units for retirees, access roads, and municipal service connections.",
        challenge: "Steep slopes and rocky terrain of the Eastern Highlands required complex terraced foundations.",
        approach: "Careful rock blasting and construction of reinforced concrete retaining walls for each terrace.",
        outcomes: [
          "Beautifully terraced units with scenic mountain views.",
          "All services successfully integrated.",
          "Delivered with high-quality interior finishes."
        ],
        gallery: Array.from({ length: 14 }, (_, i) => `/projects_assets/private_renovations/img_${i + 1}.webp`)
      }
    ]
  }
];

import { Project } from "@/types/website";

export function getMockProjectBySlug(slug: string): Project | undefined {
  const cleanSlug = slug.toLowerCase().trim();
  
  // 1. Check top-level projects
  const p = MOCK_PROJECTS.find(
    (x) => x.slug === cleanSlug || x.id.toLowerCase() === cleanSlug
  );
  if (p) {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      client: p.client,
      category: p.category,
      industry: p.industry,
      province: p.province,
      status: p.status,
      value: p.value,
      description: p.scopeSummary,
      timeline: p.timeline,
      contractType: p.contractType,
      scopeSummary: p.scopeSummary,
      challenge: p.challenge,
      approach: p.approach,
      outcomes: p.outcomes,
      featuredImage: p.image,
      gallery: p.gallery,
      documents: p.documents,
      subProjects: p.subProjects,
    };
  }

  // 2. Search sub-projects
  for (const parent of MOCK_PROJECTS) {
    if (parent.subProjects) {
      const sub = parent.subProjects.find(
        (s) => s.id.toLowerCase() === cleanSlug || s.title.toLowerCase().replace(/\s+/g, "-") === cleanSlug
      );
      if (sub) {
        return {
          id: sub.id,
          slug: sub.id.toLowerCase(),
          title: sub.title,
          client: parent.client,
          category: parent.category,
          industry: parent.industry,
          province: parent.province,
          status: sub.status,
          value: sub.value,
          description: sub.scopeSummary,
          timeline: parent.timeline,
          contractType: parent.contractType,
          scopeSummary: sub.scopeSummary,
          challenge: sub.challenge,
          approach: sub.approach,
          outcomes: sub.outcomes,
          featuredImage: parent.image,
          gallery: sub.gallery,
          documents: [],
        };
      }
    }
  }

  return undefined;
}

export function getProjectsByCapability(capabilityName: string): ProjectDetail[] {
  const name = capabilityName.toLowerCase();
  
  if (name.includes("civil")) {
    return MOCK_PROJECTS.filter(p => 
      p.category.includes("Civil") || 
      p.sector.toLowerCase().includes("civil") ||
      p.slug === "other-civil" || p.slug === "kariba"
    );
  }
  if (name.includes("commercial")) {
    return MOCK_PROJECTS.filter(p => 
      p.category.includes("Commercial") || 
      p.category.includes("Residential") || 
      p.category.includes("Institutional") ||
      p.sector.toLowerCase().includes("commercial") || 
      p.sector.toLowerCase().includes("residential") || 
      p.sector.toLowerCase().includes("institutional") ||
      p.slug === "hillcrest" || p.slug === "surrey" || p.slug === "troutbeck"
    );
  }
  if (name.includes("mining")) {
    return MOCK_PROJECTS.filter(p => 
      p.category.includes("Mining") || 
      p.sector.toLowerCase().includes("mining") ||
      p.slug === "kariba"
    );
  }
  if (name.includes("structural")) {
    return MOCK_PROJECTS.filter(p => 
      p.category.includes("Structural") || 
      p.category.includes("Industrial") ||
      p.sector.toLowerCase().includes("structural") || 
      p.sector.toLowerCase().includes("steel") ||
      p.slug === "mega-market"
    );
  }
  if (name.includes("earthworks") || name.includes("plant")) {
    return MOCK_PROJECTS.filter(p => 
      p.category.includes("Earthworks") || 
      p.scope.toLowerCase().includes("excavation") || 
      p.scope.toLowerCase().includes("groundworks") || 
      p.scope.toLowerCase().includes("paving") ||
      p.slug === "other-civil"
    );
  }
  if (name.includes("controls")) {
    return MOCK_PROJECTS.filter(p => p.slug === "kariba" || p.slug === "mega-market");
  }
  if (name.includes("design")) {
    return MOCK_PROJECTS.filter(p => 
      p.contractType.toLowerCase().includes("design") || 
      p.contractType.toLowerCase().includes("epc")
    );
  }
  
  return MOCK_PROJECTS.slice(0, 3);
}
