import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { CapabilityCard } from "@/components/sections/CapabilityCard";
import { CAPABILITIES } from "@/lib/constants";
import { HardHat, Building2, Pickaxe, TrendingUp, Cpu, Truck, LayoutDashboard, Zap } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

export const metadata = constructMetadata({
  title: "Our Capabilities | Six Nine Constructions",
  description: "End-to-end construction capabilities across civil infrastructure, commercial construction, and mining.",
});

export default function CapabilitiesIndexPage() {
  const getIcon = (name: string) => {
    switch (name) {
      case "Civil Infrastructure": return <HardHat />;
      case "Commercial Construction": return <Building2 />;
      case "Mining Infrastructure": return <Pickaxe />;
      case "Earthworks & Grading": return <TrendingUp />;
      case "Structural Engineering": return <Cpu />;
      case "Heavy Plant Operations": return <Truck />;
      case "Project Controls": return <LayoutDashboard />;
      case "Design & Build": return <Zap />;
      default: return <HardHat />;
    }
  };

  const getImage = (name: string) => {
    switch (name) {
      case "Civil Infrastructure": return "https://picsum.photos/seed/civil/1024/768";
      case "Commercial Construction": return "https://picsum.photos/seed/building/1024/768";
      case "Mining Infrastructure": return "https://picsum.photos/seed/mine/1024/768";
      case "Earthworks & Grading": return "https://picsum.photos/seed/earth/1024/768";
      case "Structural Engineering": return "https://picsum.photos/seed/steel/1024/768";
      case "Heavy Plant Operations": return "https://picsum.photos/seed/plant/1024/768";
      case "Project Controls": return "https://picsum.photos/seed/control/1024/768";
      case "Design & Build": return "https://picsum.photos/seed/design/1024/768";
      default: return "";
    }
  };

  const getDesc = (name: string) => {
    switch (name) {
      case "Civil Infrastructure": return "Major road networks, bridges, dams, and municipal water reticulation systems.";
      case "Commercial Construction": return "Corporate headquarters, retail centers, institutional facilities, and logistics hubs.";
      case "Mining Infrastructure": return "Surface infrastructure, processing plants, haul roads, and tailings dams.";
      case "Earthworks & Grading": return "Mass excavation, site leveling, terracing, and complex topological modifications.";
      case "Structural Engineering": return "Complex steel erection, reinforced concrete structures, and high-load foundations.";
      case "Heavy Plant Operations": return "Deployment and management of extensive yellow metal fleets for major earthmoving.";
      case "Project Controls": return "Data-driven scheduling, cost management, and risk mitigation using Project AEGIS.";
      case "Design & Build": return "Turnkey solutions integrating architectural, engineering, and construction phases.";
      default: return "";
    }
  };

  return (
    <PageWrapper>
      <PageHero
        title="Our Capabilities"
        subtitle="End-to-end execution across every major construction discipline, powered by Project AEGIS."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Capabilities" }
        ]}
        backgroundImage="https://images.unsplash.com/photo-1504307651254-35680f356f27?q=80&w=2940&auto=format&fit=crop"
      />

      <section className="py-24 bg-[var(--snc-white)] relative">
        <div className="container relative z-10 max-w-[2000px] mx-auto px-6 lg:px-12">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
            {CAPABILITIES.map((cap, i) => (
              <Reveal key={cap} delay={i * 0.1}>
                <CapabilityCard 
                  title={cap}
                  description={getDesc(cap)}
                  slug={cap.toLowerCase().replace(/ & /g, '-').replace(/\s+/g, '-')}
                  icon={getIcon(cap)}
                  image={getImage(cap)}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
