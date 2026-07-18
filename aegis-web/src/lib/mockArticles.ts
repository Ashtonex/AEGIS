import { Article, Tender } from "@/types/website";

export const MOCK_TENDERS: Tender[] = [
  {
    id: "tender-1",
    reference: "SNC-2026-CIV-008",
    title: "Supply and Delivery of 42.5N Structural Cement",
    category: "materials",
    province: "Harare",
    issueDate: "2026-07-10T08:00:00Z",
    closingDate: "2026-08-15T16:00:00Z",
    estimatedValue: 120000,
    status: "Open",
    description: "SNC requires the supply and bulk delivery of high-grade 42.5N structural cement for the Mega Market Warehouse expansion project.",
    requirements: [
      "Minimum 5 years trade reference in bulk cement supply",
      "SABS / SAZ certification documentation",
      "Capacity to deliver minimum 100 tons per week",
      "Valid tax clearance certificate"
    ],
    documents: [
      { title: "RFP-SNC-2026-CIV-008.pdf", url: "#" },
      { title: "Technical Specification Sheet.pdf", url: "#" }
    ],
    contactEmail: "procurement@sixnine.co.zw"
  },
  {
    id: "tender-2",
    reference: "SNC-2026-PLT-012",
    title: "Short-term Hire of 30-Ton Off-road Articulated Dump Trucks",
    category: "plant",
    province: "Mashonaland West",
    issueDate: "2026-07-11T09:00:00Z",
    closingDate: "2026-07-18T12:00:00Z",
    estimatedValue: 85000,
    status: "Closing Soon",
    description: "SNC requires hire of three (3) 30-ton off-road articulated dump trucks (ADTs) wet-rate or dry-rate for earthmoving works at the Kariba Rehabilitation site.",
    requirements: [
      "Trucks must be less than 5 years old or under 8000 operating hours",
      "Full maintenance logs required upon submission",
      "Certified operator credentials if proposing wet-hire",
      "Public liability insurance coverage minimum USD 1M"
    ],
    documents: [
      { title: "RFP-SNC-2026-PLT-012.pdf", url: "#" }
    ],
    contactEmail: "plantprocurement@sixnine.co.zw"
  },
  {
    id: "tender-3",
    reference: "SNC-2026-SUB-045",
    title: "Subcontract: High-tensile Rock Anchoring & Slope Stabilization",
    category: "subcontract",
    province: "Mashonaland West",
    issueDate: "2026-07-12T10:00:00Z",
    closingDate: "2026-08-30T17:00:00Z",
    estimatedValue: 450000,
    status: "Open",
    description: "SNC invites expressions of interest from specialized geotechnical subcontractors for high-tensile rock anchoring and mesh stabilization works.",
    requirements: [
      "Proven completion of at least 3 similar deep-rock anchoring projects",
      "Lead engineer must hold SANCOLD or equivalent accreditation",
      "Specialized drilling equipment ownership documentation",
      "Strict compliance with SNC zero-harm safety charter"
    ],
    documents: [
      { title: "RFP-SNC-2026-SUB-045.pdf", url: "#" },
      { title: "Geotechnical Site Survey.pdf", url: "#" }
    ],
    contactEmail: "contracts@sixnine.co.zw"
  },
  {
    id: "tender-4",
    reference: "SNC-2026-CIV-009",
    title: "Supply and Installation of Prefabricated Office Units",
    category: "materials",
    province: "Harare",
    issueDate: "2026-05-10T08:00:00Z",
    closingDate: "2026-06-15T16:00:00Z",
    estimatedValue: 45000,
    status: "Closed",
    description: "SNC required supply and assembly of high-durability modular container office units at the Mutare Depot project site.",
    requirements: [
      "Previous institutional or industrial prefab references",
      "Thermal insulation rating verification documentation",
      "On-site installation and utility hookup capacity"
    ],
    documents: [
      { title: "RFP-SNC-2026-CIV-009.pdf", url: "#" }
    ],
    contactEmail: "procurement@sixnine.co.zw"
  }
];

export const MOCK_NEWS_ARTICLES: Article[] = [
  {
    id: "news-1",
    slug: "platinum-processing-expansion",
    title: "SNC Awarded Phase 2 of Platinum Processing Plant Expansion",
    category: "Project Update",
    publishDate: "2025-06-15T00:00:00Z",
    excerpt: "SNC has been retained as the principal contractor for the $45M Phase 2 expansion contract for Global Platinum Resources in the Midlands Province.",
    author: "Corporate Communications",
    featuredImage: "/proj-mining.jpg",
    content: `
      <p class="lead">Six Nine Construction (SNC) is pleased to announce the successful award of the Phase 2 expansion contract for the Global Platinum Resources processing plant in the Midlands Province.</p>
      
      <p>Following the successful, early completion of Phase 1, SNC has been retained as the principal contractor for the $45M expansion phase. The scope of work encompasses major civil works, structural steel erection, and the installation of secondary milling circuits.</p>
      
      <h3>Engineering Complexity</h3>
      <p>The primary challenge of Phase 2 involves executing deep foundation works adjacent to the live Phase 1 plant without disrupting ongoing operations. SNC will leverage its proprietary digital command center, Project AEGIS, to synchronize construction activities with the plant's operational schedule.</p>
      
      <p>"This award validates our engineering-led approach to construction," stated the Managing Director of SNC. "Our ability to provide absolute transparency through AEGIS, combined with our rigorous safety standards, makes us the partner of choice for complex brownfield expansions."</p>
      
      <h3>Timeline and Mobilization</h3>
      <p>Site mobilization is scheduled for Q3 2025, with an anticipated practical completion date of Q4 2026. The project is expected to create over 300 jobs during the peak construction phase, aligning with SNC's commitment to local skills development.</p>
    `
  },
  {
    id: "news-2",
    slug: "digital-twin-aegis-launch",
    title: "SNC Launches Digital Twin Integration inside Project AEGIS",
    category: "Company News",
    publishDate: "2025-05-10T00:00:00Z",
    excerpt: "SNC introduces real-time 3D telemetry and digital twin mapping into Project AEGIS for high-precision progress tracking and structural health monitoring.",
    author: "Technology Division",
    featuredImage: "/proj-earthworks.jpg",
    content: `
      <p class="lead">Six Nine Construction continues to pioneer digital construction methods in Southern Africa with the deployment of live digital twin monitoring within our proprietary Project AEGIS platform.</p>
      
      <p>The system integrates real-time IoT sensor telemetry, periodic LiDAR drone scans, and building information models (BIM) into a unified dashboard. This allows project executives, engineers, and clients to inspect construction tolerance down to the millimeter from any web browser.</p>
      
      <h3>Preventative Analytics</h3>
      <p>By comparing real-time structural load data against the design models, the AEGIS engine can detect settlement or deformation issues before they pose a physical safety hazard. The machine learning model analyzes concrete curing temp curves to advise on formwork stripping timelines dynamically.</p>
      
      <p>"We aren't just building structures; we are building data-rich virtual assets," says the Chief Technology Officer. "Clients receive a complete spatial database of their facility, reducing operation and maintenance costs over the lifecycle."</p>
    `
  },
  {
    id: "news-3",
    slug: "safety-milestone-kariba",
    title: "SNC Achieves 2 Million Safe Man-Hours at Kariba Dam Project",
    category: "Award",
    publishDate: "2025-04-18T00:00:00Z",
    excerpt: "Specialist teams complete crucial plunge pool stabilization phase with zero lost-time injuries under highly challenging underwater conditions.",
    author: "HSE Department",
    featuredImage: "/proj-bridge.jpg",
    content: `
      <p class="lead">Six Nine Construction has achieved a significant safety milestone at the Kariba Dam Rehabilitation Project, surpassing 2,000,000 man-hours worked without a single Lost Time Injury (LTI).</p>
      
      <p>This achievement is particularly noteworthy given the high-risk nature of the scope, which includes deep underwater diving, heavy marine rigging, high-pressure grout injections, and steep rock slope stabilization.</p>
      
      <h3>Culture of Accountability</h3>
      <p>SNC's success is rooted in its site-wide 'Safety First, Execution Second' charter. Every shift begins with a collaborative risk-mapping session, and all personnel are empowered with Stop Work Authority if they identify an active hazard.</p>
      
      <p>"Safety is not a metric we track; it is a value that guides our operations," commented the Project HSE Manager. "In underwater rehabilitation, conditions change in minutes. Surpassing 2 million safe hours is a testament to the discipline of our team."</p>
    `
  },
  {
    id: "news-4",
    slug: "infrastructure-trends-2026",
    title: "Southern African Infrastructure Trends: A 2026 Outlook",
    category: "Industry",
    publishDate: "2026-01-05T00:00:00Z",
    excerpt: "An in-depth analysis of public-private partnerships, sustainable engineering, and logistics corridor investments shaping regional infrastructure in 2026.",
    author: "SNC Research",
    featuredImage: "/proj-highway.jpg",
    content: `
      <p class="lead">As we enter 2026, the demand for resilient regional logistics corridors, renewable energy integration, and robust water infrastructure is reshaping Southern African construction priorities.</p>
      
      <p>Our research team has identified three core trends defining major infrastructure projects in the coming year: the rise of private sector co-funding in transport links, the mandate for carbon-neutral concrete formulations, and the regional standardization of digital compliance reporting.</p>
      
      <h3>Logistics & Transit Corridors</h3>
      <p>The refurbishment of highway corridors linking deep-water ports to mining hubs is attracting unprecedented funding. Construction firms capable of executing heavy-duty concrete pavement works under live traffic conditions will see major opportunities.</p>
    `
  }
];

export const MOCK_KNOWLEDGE_ARTICLES: Article[] = [
  {
    id: "knowledge-1",
    slug: "mass-concrete-thermal-cracking",
    title: "Mitigating Thermal Cracking in Mass Concrete Pours",
    category: "Industry",
    publishDate: "2025-08-01T00:00:00Z",
    excerpt: "A technical guide detailing cooling pipe layout designs, fly-ash replacement ratios, and telemetry instrumentation for large-scale foundations.",
    author: "Engineering Council",
    featuredImage: "/proj-earthworks.jpg",
    content: `
      <p class="lead">Mass concrete elements—such as thick raft foundations, bridge piers, and dam structures—are highly susceptible to thermal cracking caused by the heat of hydration. This technical brief outlines SNC's field-tested mitigation protocols.</p>
      
      <h3>1. Concrete Mix Design Optimization</h3>
      <p>To reduce peak hydration temperatures, we recommend replacing up to 40% of Portland cement with supplementary cementitious materials (SCMs) such as fly ash or ground granulated blast-furnace slag (GGBS). This slows down the hydration rate and lowers the thermal peak.</p>
      
      <h3>2. Active Liquid Nitrogen Pre-Cooling</h3>
      <p>Injecting liquid nitrogen directly into the transit mixer or adding shaved ice to the batching water reduces the concrete placement temperature below the critical 15°C threshold, providing a vital thermal buffer.</p>
      
      <h3>3. Temperature Telemetry Instrumentation</h3>
      <p>Specialized thermocouples must be embedded at the core, mid-depth, and surface of the concrete element. Real-time temperature differentials must be maintained below 20°C using automated insulated blankets to prevent thermal stress cracking.</p>
    `
  },
  {
    id: "knowledge-2",
    slug: "pavements-heavy-haulage",
    title: "Design & Construction of Concrete Pavements for Heavy Haulage Logistics Yards",
    category: "Industry",
    publishDate: "2025-07-20T00:00:00Z",
    excerpt: "SNC engineering protocols for high-compressive subgrade preparation, dowel bar alignment, and joint sealing to prevent joint stepping under heavy axle loads.",
    author: "Infrastructure Advisory",
    featuredImage: "/proj-highway.jpg",
    content: `
      <p class="lead">Logistics yards subjected to continuous heavy haulage and container handlers require pavement designs capable of resisting extreme shear stresses and point loads. This paper details jointing and doweling best practices.</p>
      
      <h3>Subgrade & Base Stabilization</h3>
      <p>Failing to stabilize the underlying subgrade is the leading cause of concrete pavement failure. SNC utilizes in-situ cement stabilization to a minimum depth of 300mm to achieve an elastic modulus capable of supporting heavy transport maneuvers.</p>
      
      <h3>Dowel Bar Alignment Precision</h3>
      <p>Misaligned dowel bars lock the joints, preventing normal thermal expansion and causing severe spalling. We mandate the use of laser-aligned steel dowel baskets to guarantee horizontal and vertical tolerances remain within 3mm.</p>
    `
  },
  {
    id: "knowledge-3",
    slug: "cofferdam-hydro-rehabilitation",
    title: "Specialized Cofferdam Engineering for Deep-Water Hydro Rehabilitation",
    category: "Project Update",
    publishDate: "2025-06-30T00:00:00Z",
    excerpt: "Review of underwater structural shoring, pressure grouting seals, and hydrodynamic flow deflection models developed for active hydro-generation dams.",
    author: "Hydro Power Division",
    featuredImage: "/proj-bridge.jpg",
    content: `
      <p class="lead">Executing structural rehabilitation on active dams requires isolating work zones using deep-water cofferdams. This technical brief details the engineering behind high-pressure watertight cofferdam seals.</p>
      
      <h3>Hydrodynamic Deflection Models</h3>
      <p>Placing structural shoring in high-velocity plunge pools requires hydrodynamic modeling. Computational fluid dynamics (CFD) are used to shape the cofferdam nose, reducing drag forces and local scour effects during high-spill periods.</p>
      
      <h3>Pressure Grouting Watertight Seals</h3>
      <p>To achieve a dry excavation chamber, the contact boundary between the sheet piles and irregular bedrock must be sealed using specialized underwater concrete grouting. Our team utilizes micro-fine cement grout injected at low pressures to seal rock fissures without fracturing the host geology.</p>
    `
  }
];

export function getMockArticleBySlug(slug: string): Article | undefined {
  const cleanSlug = slug.toLowerCase().trim();
  const allArticles = [...MOCK_NEWS_ARTICLES, ...MOCK_KNOWLEDGE_ARTICLES];
  return allArticles.find(
    (a) => a.slug === cleanSlug || a.id.toLowerCase() === cleanSlug
  );
}
