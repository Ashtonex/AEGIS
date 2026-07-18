import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { INDUSTRIES } from "@/lib/constants";
import { getProjects } from "@/lib/api";
import { Pickaxe, Landmark, Building2, Factory, Zap, Truck, Sprout, HardHat, ArrowRight } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import Link from "next/link";

export const metadata = constructMetadata({
  title: "Sectors & Industries | Six Nine Construction",
  description: "Explore the primary industry sectors SNC operates in, including Mining, Government, Commercial, and heavy Infrastructure.",
});

// Sector Details containing descriptions, fallback metrics, and images
const SECTOR_DETAILS: Record<string, {
  description: string;
  fallbackActive: number;
  fallbackCompleted: number;
  financialVolume: string;
  bgImage: string;
}> = {
  Mining: {
    description: "Heavy earthworks, processing plants, haul road construction, and specialized concrete infrastructure built to withstand severe operations.",
    fallbackActive: 4,
    fallbackCompleted: 24,
    financialVolume: "$142.5M",
    bgImage: "/proj-mining.jpg"
  },
  Government: {
    description: "Public infrastructure, municipal assets, and utility networks delivered under strict regulatory compliance and budget controls.",
    fallbackActive: 3,
    fallbackCompleted: 18,
    financialVolume: "$89.2M",
    bgImage: "/proj-bridge.jpg"
  },
  Commercial: {
    description: "Corporate offices, mixed-use developments, logistics warehousing, and retail hubs constructed with high aesthetic and structural standards.",
    fallbackActive: 5,
    fallbackCompleted: 32,
    financialVolume: "$115.8M",
    bgImage: "/proj-commercial.jpg"
  },
  Industrial: {
    description: "Heavy-duty manufacturing facilities, assembly lines, logistics parks, and processing centers engineered for maximum throughput.",
    fallbackActive: 2,
    fallbackCompleted: 15,
    financialVolume: "$76.4M",
    bgImage: "/snc_industrial_warehouse.png"
  },
  Energy: {
    description: "Substation foundations, solar farm civil grading, transmission grid anchor works, and thermal power plant civil works.",
    fallbackActive: 3,
    fallbackCompleted: 11,
    financialVolume: "$95.0M",
    bgImage: "/hero_cinematic.png"
  },
  Transport: {
    description: "High-capacity highway networks, concrete highway bridges, arterial corridor expansions, and public transit nodes.",
    fallbackActive: 6,
    fallbackCompleted: 41,
    financialVolume: "$210.3M",
    bgImage: "/proj-highway.jpg"
  },
  Agriculture: {
    description: "Macro reservoirs, extensive canal networks, modern crop storage silos, and secondary processing facilities.",
    fallbackActive: 2,
    fallbackCompleted: 14,
    financialVolume: "$34.1M",
    bgImage: "/proj-earthworks.jpg"
  },
  Infrastructure: {
    description: "Water purification networks, heavy retention systems, civic utility complexes, and large-scale urban infrastructure works.",
    fallbackActive: 7,
    fallbackCompleted: 29,
    financialVolume: "$180.6M",
    bgImage: "/snc_civil_yard.png"
  }
};

export default async function IndustriesIndexPage() {
  // Query all projects from backend API to perform dynamic aggregation
  const projectsResponse = await getProjects().catch(() => null);
  const projects = projectsResponse?.data || [];

  const getIcon = (name: string) => {
    switch (name) {
      case "Mining": return <Pickaxe className="w-6 h-6 text-[#D4AF37]" />;
      case "Government": return <Landmark className="w-6 h-6 text-[#D4AF37]" />;
      case "Commercial": return <Building2 className="w-6 h-6 text-[#D4AF37]" />;
      case "Industrial": return <Factory className="w-6 h-6 text-[#D4AF37]" />;
      case "Energy": return <Zap className="w-6 h-6 text-[#D4AF37]" />;
      case "Transport": return <Truck className="w-6 h-6 text-[#D4AF37]" />;
      case "Agriculture": return <Sprout className="w-6 h-6 text-[#D4AF37]" />;
      case "Infrastructure": return <HardHat className="w-6 h-6 text-[#D4AF37]" />;
      default: return <HardHat className="w-6 h-6 text-[#D4AF37]" />;
    }
  };

  const getMetrics = (sectorName: string) => {
    // Filter active and completed projects matching the sector name dynamically
    const sectorProjects = projects.filter(p => p.industry === sectorName);
    const activeCount = sectorProjects.filter(p => p.status === "Active").length;
    const completedCount = sectorProjects.filter(p => p.status === "Completed").length;

    const details = SECTOR_DETAILS[sectorName] || {
      description: "",
      fallbackActive: 0,
      fallbackCompleted: 0,
      financialVolume: "$0.0M",
      bgImage: ""
    };

    return {
      description: details.description,
      active: activeCount || details.fallbackActive,
      completed: completedCount || details.fallbackCompleted,
      volume: details.financialVolume,
      bgImage: details.bgImage
    };
  };

  return (
    <PageWrapper>
      <PageHero
        title="Sectors & Industries"
        subtitle="SNC delivers precision-engineered infrastructure across eight core operational sectors."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Industries" }
        ]}
        backgroundImage="/proj-highway.jpg"
      />

      <section className="py-24 bg-[#050505] relative blueprint-grid">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {INDUSTRIES.map((sector, i) => {
              const metrics = getMetrics(sector);
              const slug = sector.toLowerCase();

              return (
                <Reveal key={sector} delay={i * 0.05}>
                  <Link 
                    href={`/industries/${slug}`}
                    className="group relative flex flex-col h-full bg-[#0a0a0a] border border-[#1c1c1c] p-8 hover:border-[#D4AF37]/50 transition-all duration-300 rounded-sm overflow-hidden"
                  >
                    {/* Live Telemetry Indicator using Electric Blue */}
                    <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-[#3B82F6]/5 border border-[#3B82F6]/20 px-2.5 py-0.5 rounded-full z-20">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse" />
                      <span className="text-[9px] font-mono tracking-widest text-[#3B82F6] font-bold uppercase">LIVE</span>
                    </div>

                    {/* Sector Icon */}
                    <div className="w-12 h-12 border border-[#1c1c1c] bg-[#111111] flex items-center justify-center mb-6 group-hover:border-[#D4AF37]/30 group-hover:bg-[#D4AF37]/5 transition-all">
                      {getIcon(sector)}
                    </div>

                    {/* Sector Title */}
                    <h3 className="font-sans text-xl font-bold text-white mb-3 group-hover:text-[#D4AF37] transition-colors">
                      {sector}
                    </h3>

                    {/* Description */}
                    <p className="text-sm text-slate-light leading-relaxed mb-6 flex-1 line-clamp-3">
                      {metrics.description}
                    </p>

                    {/* Live Telemetry Metrics */}
                    <div className="mt-auto pt-6 border-t border-[#1c1c1c] grid grid-cols-3 gap-2">
                      <div>
                        <span className="block text-[8px] font-mono tracking-widest text-slate uppercase mb-1">Active</span>
                        <span className="text-base font-mono font-bold tabular-nums text-[#3B82F6]">{metrics.active}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] font-mono tracking-widest text-slate uppercase mb-1">Completed</span>
                        <span className="text-base font-mono font-bold tabular-nums text-white">{metrics.completed}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] font-mono tracking-widest text-slate uppercase mb-1">Volume</span>
                        <span className="text-base font-mono font-bold tabular-nums text-white">{metrics.volume}</span>
                      </div>
                    </div>

                    {/* Explore Link with Active Reveal state */}
                    <div className="mt-6 flex items-center justify-between text-xs font-mono uppercase tracking-widest text-slate-light group-hover:text-[#D4AF37] transition-colors">
                      <span>Explore Sector</span>
                      <div className="w-8 h-8 rounded-full border border-[#1c1c1c] group-hover:border-[#D4AF37] group-hover:bg-[#D4AF37] group-hover:text-[#050505] flex items-center justify-center transition-all duration-300">
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
