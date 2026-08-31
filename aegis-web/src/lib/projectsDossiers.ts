import { Project } from "@/types/website";

export interface ProjectDossier extends Project {
  earthworksVolumeM3?: number;
  concreteVolumeM3?: number;
  steelTonnage?: number;
  pavementKm?: number;
  activePlant?: string[];
  coordinates?: { lat: number; lng: number };
  qaqcStandards?: string[];
  hseRecord?: string;
}

export const PROJECTS_DOSSIERS: ProjectDossier[] = [
  {
    id: "SNC-MEGA-MARKET",
    slug: "snc-mega-market",
    title: "Mega Market Industrial Flour Mill & Bulk Storage Complex",
    category: "Industrial Infrastructure",
    industry: "Industrial",
    province: "Manicaland",
    status: "Completed",
    client: "Private industrial client",
    timeline: {
      start: "2023-02-15",
      end: "2024-08-30",
    },
    contractType: "FIDIC Yellow Book (Design & Build)",
    description:
      "Comprehensive multi-phase industrial agro-processing complex comprising high-capacity wheat flour milling infrastructure, 33kV step-down electrical substation, heavy transport logistics yard, stormwater attenuation, and high-load cantilever retaining structures.",
    scopeSummary:
      "Civil foundation works on engineered compacted fill, 45,000m² heavy-duty articulated transport yard, concrete structural silos bases, electrical substation civil blast walls, 1.2km reinforced concrete stormwater flumes, and deep cantilever retaining walls.",
    challenge:
      "Site topography presented extreme elevation gradients (14m cross-fall across 220m) adjacent to seasonal drainage basins. Subsoil investigation revealed erratic decomposing granite layers requiring systematic ground stabilization and structural retaining without disrupting adjacent railway siding logistics.",
    approach:
      "Engineered continuous tiered reinforced concrete cantilever retaining walls anchored with sub-surface geopipes. Mobilized on-site batching plant maintaining certified C30/C37 structural compressive mix with continuous slump testing and nuclear density gauge (NDG) compaction compliance exceeding 98% Mod AASHTO.",
    outcomes: [
      "Zero lost-time injuries (LTI) across 480,000 site man-hours.",
      "Commissioned ahead of seasonal high-precipitation window.",
      "Heavy transport logistics yard engineered to withstand 45-ton continuous axle loads without deflection.",
      "Full handover compliance with Municipal Town Planning and Factory Inspectorate certifications.",
    ],
    featuredImage: "/proj-commercial.jpg",
    gallery: [
      "/projects_assets/mm_flour_mill_substation/1.webp",
      "/projects_assets/mm_transport_yard/1.webp",
      "/projects_assets/mm_retaining_walls/1.webp",
      "/projects_assets/mm_stormwater/1.webp",
    ],
    earthworksVolumeM3: 68000,
    concreteVolumeM3: 11400,
    steelTonnage: 840,
    pavementKm: 2.8,
    activePlant: [
      "CAT 336D Hydraulic Excavator",
      "CAT D7R Track Bulldozer",
      "CAT 140K Motor Grader",
      "Hamm 3411 Padfoot Roller",
      "Mercedes-Benz Actros 3340 Tippers",
    ],
    coordinates: { lat: -18.9728, lng: 32.6514 },
    qaqcStandards: ["COTO Standard Specifications", "SANS 1200", "BS 8110 Concrete"],
    hseRecord: "480,000 LTI-Free Hours",
    subProjects: [
      {
        id: "SNC-MM-WMC",
        title: "Flour Mill Civils & 33kV Substation",
        status: "Completed",
        budget: "Commercial terms withheld",
        value: 0,
        duration: "10 Months",
        scopeSummary: "Mass concrete foundations, vibrating equipment dampening plinths, transformer bund walls.",
        challenge: "Dynamic vibration absorption for high-speed roller mills.",
        approach: "High-density concrete plinths isolated with elastomeric acoustic dampening membranes.",
        outcomes: ["Vibration tolerances verified within ISO 10816 standards.", "Transformer oil containment zero-leak verification."],
        gallery: ["/projects_assets/mm_flour_mill_substation/1.webp"],
      },
      {
        id: "SNC-MM-TY",
        title: "Heavy Transport Yard & Intermodal Pavement",
        status: "Completed",
        budget: "Commercial terms withheld",
        value: 0,
        duration: "8 Months",
        scopeSummary: "45,000m² concrete interlocking heavy paving on G1 crushed rock base course.",
        challenge: "Subgrade moisture retention and heavy localized point loading from static trailer landing gear.",
        approach: "80mm Class 40 interlocking pavers over 150mm stabilized subbase with sub-surface drainage grid.",
        outcomes: ["No rutting or settlement under maximum freight loading.", "100% surface drainage efficiency during monsoonal downpours."],
        gallery: ["/projects_assets/mm_transport_yard/1.webp"],
      },
    ],
  },
  {
    id: "SNC-SURREY",
    slug: "snc-surrey",
    title: "Surrey Commercial Cold-Chain Logistics Complex",
    category: "Commercial Construction",
    industry: "Commercial",
    province: "Mashonaland East",
    status: "Completed",
    client: "Private commercial client",
    timeline: {
      start: "2023-06-01",
      end: "2024-03-20",
    },
    contractType: "Lump Sum Turnkey",
    description:
      "State-of-the-art commercial meat processing, bakery, cold-chain distribution center, and retail forecourt complex along the Harare-Mutare economic corridor.",
    scopeSummary:
      "Structural steel portal frames, FM2-specification laser-screed jointless concrete industrial floor slabs, food-grade insulated composite panel envelope, dock levellers, and integrated retail facilities.",
    challenge:
      "Stringent international food safety standards (HACCP) required crack-free, dustless concrete floors with zero tolerance for standing water, coupled with an aggressive 9-month critical-path program prior to festive season retail launch.",
    approach:
      "Deployed laser-guided floor screeding technology and dry-shake metallic surface hardeners. Steel portal structures fabricated off-site under strict QA/QC shop welding protocols and erected with 50-ton mobile cranes during sequenced work windows.",
    outcomes: [
      "Handed over 2 weeks ahead of scheduled retail launch.",
      "Achieved FM2 floor flat standard for high-reach narrow-aisle forklift operations.",
      "Refrigeration thermal envelope certified with zero thermal bridging.",
    ],
    featuredImage: "/proj-highway.jpg",
    gallery: [
      "/projects_assets/surrey_pie_shop/1.webp",
      "/projects_assets/surrey_pie_shop/2.webp",
    ],
    earthworksVolumeM3: 32000,
    concreteVolumeM3: 5600,
    steelTonnage: 420,
    pavementKm: 1.4,
    activePlant: [
      "SANY 50T Rough Terrain Crane",
      "CAT 428F Backhoe Loader",
      "Ride-on Double Power Trowels",
      "CAT 320D Excavator",
    ],
    coordinates: { lat: -18.1884, lng: 31.5542 },
    qaqcStandards: ["HACCP Civil Compliant", "BS EN 1993 Steel", "TR34 4th Edition Concrete Floors"],
    hseRecord: "320,000 LTI-Free Hours",
  },
  {
    id: "SNC-TROUTBECK",
    slug: "snc-troutbeck",
    title: "Troutbeck High-Altitude Infrastructure & Civil Reticulation",
    category: "Civil Infrastructure",
    industry: "Hospitality",
    province: "Manicaland",
    status: "Completed",
    client: "Hospitality sector client",
    timeline: {
      start: "2023-08-10",
      end: "2024-04-15",
    },
    contractType: "Measurement & Value",
    description:
      "High-altitude mountain civil works comprising environmental stormwater reticulation, erosion control, bridge abutment rehabilitation, and durable access roads at 2,200m elevation.",
    scopeSummary:
      "Deep stone pitching, rock revetments, sub-soil perforated drainage systems, asphalt surfacing in frost-prone mountain terrain, and eco-sensitive stream crossing structures.",
    challenge:
      "Extreme gradient, high precipitation, and delicate montane ecosystem. Standard earthmoving machinery faced traction and soil shear limits on steep hillsides during unpredictable mountain rain storms.",
    approach:
      "Utilized low-ground-pressure (LGP) tracked machinery, bio-engineering revetments, and locally quarried granite riprap for energy-dissipating flumes. Cold-weather asphalt mix formulations used to resist high-altitude thermal cracking.",
    outcomes: [
      "100% preservation of sensitive indigenous mountain catchment reserves.",
      "Zero erosion blowout during heavy 2023/2024 rainy season.",
      "Substantially lowered annual road maintenance lifecycle costs for client.",
    ],
    featuredImage: "/proj-bridge.jpg",
    gallery: [
      "/projects_assets/troutbeck/1.webp",
      "/projects_assets/troutbeck/2.webp",
    ],
    earthworksVolumeM3: 24000,
    concreteVolumeM3: 2100,
    steelTonnage: 110,
    pavementKm: 5.2,
    activePlant: [
      "CAT 320D LGP Excavator",
      "Bell B25E Articulated Dump Truck",
      "Bomag BW120 Roller",
    ],
    coordinates: { lat: -18.1724, lng: 32.7842 },
    qaqcStandards: ["EMA Environmental Clearance", "COTO Mountain Earthworks", "SANS 1200 LB"],
    hseRecord: "180,000 LTI-Free Hours",
  },
  {
    id: "SNC-HILLCREST",
    slug: "snc-hillcrest",
    title: "Hillcrest Civil Terracing & Retention Works",
    category: "Civil Infrastructure",
    industry: "Education",
    province: "Manicaland",
    status: "Completed",
    client: "Institutional education client",
    timeline: {
      start: "2023-01-10",
      end: "2023-09-30",
    },
    contractType: "Fixed Price",
    description:
      "Civil platforms, deep drainage channels, multi-tiered gabion retaining walls, and precision sports facility earthworks engineered into mountainous topography.",
    scopeSummary:
      "Bulk cut-to-fill balancing of 42,000m³, engineered fill compaction to 95% Mod AASHTO, 800m of galvanized woven mesh gabion baskets, and storm attenuation infrastructure.",
    challenge:
      "Managing high-velocity stormwater run-off from upper mountain slopes threatening lower campus structures during construction.",
    approach:
      "Constructed progressive temporary catchment berms and silt traps ahead of permanent tiered gabions with geotextile filtration fabric to prevent subsoil migration.",
    outcomes: [
      "Completely mitigated seasonal hillside landslide risks.",
      "Delivered certified flat building platforms for future institutional expansion.",
    ],
    featuredImage: "/proj-earthworks.jpg",
    gallery: [
      "/projects_assets/hillcrest/1.webp",
    ],
    earthworksVolumeM3: 42000,
    concreteVolumeM3: 1400,
    steelTonnage: 65,
    pavementKm: 1.1,
    activePlant: [
      "CAT 330D Excavator",
      "CAT D6R Bulldozer",
      "Dynapac CA250 Compactor",
    ],
    coordinates: { lat: -18.9862, lng: 32.6284 },
    qaqcStandards: ["SANS 1200 F Gabions", "COTO Cut & Fill"],
    hseRecord: "150,000 LTI-Free Hours",
  },
  {
    id: "SNC-GREAT-DYKE",
    slug: "snc-great-dyke",
    title: "Great Dyke Heavy Mining Haul Corridor & River Crossing",
    category: "Mining Infrastructure",
    industry: "Mining",
    province: "Midlands",
    status: "Active",
    client: "Mining sector client",
    timeline: {
      start: "2024-01-15",
      end: "2025-06-30",
    },
    contractType: "FIDIC Red Book",
    description:
      "Heavy-duty civil infrastructure corridor serving active platinum and chrome extraction operations, including 28km of mine-grade haul roads, reinforced concrete box culverts, and high-load river crossings.",
    scopeSummary:
      "Clearing, dynamic subgrade stabilization, importation of G1 crushed rock base, 28km heavy pavement engineered for 60-ton axle-load ore trucks, 6 multi-cell structural culverts.",
    challenge:
      "Maintaining continuous mining haulage operations with zero downtime while constructing culvert crossings through black cotton expansive clay soils prone to massive volumetric seasonal shrinkage and heave.",
    approach:
      "Chemical stabilization with 4% road lime and cement blend on subgrade, followed by high-strength non-woven geotextile separation layers. Precast culvert elements installed in 48-hour coordinated diversion windows.",
    outcomes: [
      "Haul cycle times reduced by 35% across operational sections.",
      "Zero wet-season road closures logged in active sections.",
      "Zero lost-time injuries achieved across continuous 24/7 site operations.",
    ],
    featuredImage: "/proj-mining.jpg",
    gallery: [
      "/proj-mining.jpg",
      "/proj-highway.jpg",
    ],
    earthworksVolumeM3: 185000,
    concreteVolumeM3: 8900,
    steelTonnage: 620,
    pavementKm: 28.0,
    activePlant: [
      "CAT 349D Heavy Excavators (2 units)",
      "CAT D8R Bulldozers (2 units)",
      "CAT 140M Motor Graders (3 units)",
      "Bell B40E Articulated Dump Trucks (6 units)",
      "CAT 815F Soil Compactors",
      "Mercedes-Benz 30,000L Water Bowsers",
    ],
    coordinates: { lat: -19.0142, lng: 30.1254 },
    qaqcStandards: ["Mine Health and Safety Act", "COTO Heavy Pavement G1", "BS 5400 Bridges"],
    hseRecord: "720,000 LTI-Free Hours",
  },
  {
    id: "SNC-FORBES-CORRIDOR",
    slug: "snc-forbes-corridor",
    title: "Forbes Border Post Strategic Freight Dualization",
    category: "Civil Infrastructure",
    industry: "Transport",
    province: "Manicaland",
    status: "In Progress",
    client: "Public infrastructure client",
    timeline: {
      start: "2024-03-01",
      end: "2025-11-30",
    },
    contractType: "EPC / Joint Venture",
    description:
      "Strategic dualization and geometric realignment of the primary international freight corridor linking Zimbabwe to the Port of Beira, Mozambique.",
    scopeSummary:
      "12km road dualization, mountain rock blasting, reinforced concrete retaining systems, heavy-vehicle weighbridge platforms, and high-drainage stormwater infrastructure.",
    challenge:
      "Extremely constrained mountain pass topography with continuous commercial transit traffic (over 900 heavy freight trucks daily) with zero detour alternatives.",
    approach:
      "Sequenced rock pre-splitting and controlled blasting during scheduled off-peak transit windows. Deploying rapid-setting asphalt concrete wearing course and automated temporary traffic management telemetry.",
    outcomes: [
      "Over 4.5km of dual carriageway opened to freight transit ahead of initial milestone.",
      "Freight border clearance congestion reduced by 40% at interim staging points.",
    ],
    featuredImage: "/proj-highway.jpg",
    gallery: [
      "/proj-highway.jpg",
      "/arrival-01.jpg",
    ],
    earthworksVolumeM3: 110000,
    concreteVolumeM3: 9200,
    steelTonnage: 750,
    pavementKm: 12.0,
    activePlant: [
      "CAT 336D Excavators (3 units)",
      "CAT D8R Bulldozer",
      "Vögele Super 1800-3 Asphalt Paver",
      "Hamm HD90 Oscillating Rollers",
    ],
    coordinates: { lat: -18.9785, lng: 32.7128 },
    qaqcStandards: ["SADC Protocol on Transport", "COTO Standard Specifications", "ISO 9001:2015"],
    hseRecord: "410,000 LTI-Free Hours",
  },
  {
    id: "SNC-ZVISHAVANE-TSF",
    slug: "snc-zvishavane-tsf",
    title: "Zvishavane Tailings Storage Facility (TSF) & Water Dam",
    category: "Earthworks & Grading",
    industry: "Mining",
    province: "Midlands",
    status: "Completed",
    client: "Mining sector client",
    timeline: {
      start: "2023-04-01",
      end: "2023-12-15",
    },
    contractType: "FIDIC Red Book",
    description:
      "Bulk earthworks construction of Stage 3 Tailings Storage Facility containment embankment, return water dam, and HDPE geomembrane barrier lining.",
    scopeSummary:
      "Bulk excavation of 145,000m³, compacted clay core cutoff trench, rockfill toe buttress, 120,000m² of 2.0mm HDPE smooth and textured geomembrane liner installation, decant tower concrete civils.",
    challenge:
      "Zero-leakage environmental mandate in proximity to sensitive groundwater aquifers, requiring flawless QA/QC electric spark testing of all HDPE weld seams.",
    approach:
      "Constructed multi-zone zoned earthfill embankment with selected impermeable clay core compacted to 100% standard Proctor. Deployed certified geomembrane thermal wedge welders with independent ultrasonic testing.",
    outcomes: [
      "100% weld integrity verification on over 18,000 linear meters of HDPE extrusion seams.",
      "Delivered environmental compliance certification approved by EMA.",
    ],
    featuredImage: "/proj-earthworks.jpg",
    gallery: [
      "/proj-earthworks.jpg",
      "/proj-mining.jpg",
    ],
    earthworksVolumeM3: 145000,
    concreteVolumeM3: 3100,
    steelTonnage: 190,
    pavementKm: 3.5,
    activePlant: [
      "CAT 345D Excavators",
      "CAT D8R Bulldozer",
      "Bell B40D ADTs (4 units)",
      "Dynapac Padfoot Compactor",
    ],
    coordinates: { lat: -20.3122, lng: 30.0489 },
    qaqcStandards: ["GISTM Global Tailings Standard", "SANS 10286", "EMA Regulations"],
    hseRecord: "390,000 LTI-Free Hours",
  },
];

export function getProjectDossier(slugOrId: string): ProjectDossier | undefined {
  const normalized = slugOrId.toLowerCase().replace(/[\s_]+/g, "-");
  return PROJECTS_DOSSIERS.find(
    (p) =>
      p.id.toLowerCase() === normalized ||
      p.slug.toLowerCase() === normalized ||
      p.id.toLowerCase().replace(/[\s_]+/g, "-") === normalized
  );
}
