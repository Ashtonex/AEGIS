"use client";

import Link from "next/link";
import { SectionLabel } from "../ui/SectionLabel";
import { DashboardMock } from "../ui/DashboardMock";
import { Button } from "../ui/Button";
import { RevealOnScroll } from "../ui/RevealOnScroll";
import { StaggerContainer, StaggerItem } from "../ui/StaggerContainer";
import { 
  BarChart3, Settings, ShieldCheck, Truck, Users, 
  FileText, LayoutDashboard, HardHat 
} from "lucide-react";

export function AEGISShowcase() {
  const modules = [
    { icon: HardHat, label: "Project Management" },
    { icon: Truck, label: "Fleet" },
    { icon: FileText, label: "Procurement" },
    { icon: BarChart3, label: "Finance" },
    { icon: ShieldCheck, label: "Safety & HSE" },
    { icon: Users, label: "HR" },
    { icon: LayoutDashboard, label: "Analytics" },
    { icon: Settings, label: "Compliance" },
  ];

  return (
    <section className="py-28 md:py-44 bg-snc-void border-y border-snc-border overflow-hidden">
      <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
        <RevealOnScroll>
          <div className="max-w-3xl mb-16">
            <SectionLabel label="Platform" />
            <h2 className="text-headline-xl text-snc-text-primary mt-4 mb-6">Engineered Operations.<br className="hidden md:block"/> Complete Visibility.</h2>
            <p className="text-body-lg text-snc-text-secondary leading-relaxed max-w-2xl">
              Six Nine Construction operates on PROJECT AEGIS — a bespoke enterprise resource planning ecosystem built specifically for construction. Every project, every asset, every person, every document — unified.
            </p>
          </div>
        </RevealOnScroll>

        <RevealOnScroll delay={0.2} className="relative mb-20">
          <div className="absolute -inset-4 md:-inset-10 bg-gradient-to-b from-snc-electric/10 to-transparent blur-3xl rounded-full z-0 opacity-50" />
          <DashboardMock />
        </RevealOnScroll>

        <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-16">
          {modules.map((mod, i) => (
            <StaggerItem key={i}>
              <div className="group p-4 rounded-sm border border-snc-border bg-snc-navy flex flex-col items-center justify-center text-center hover:border-snc-electric hover:bg-snc-electric-ghost transition-all cursor-pointer h-full">
                <mod.icon className="w-6 h-6 text-snc-text-tertiary group-hover:text-snc-electric transition-colors mb-3" strokeWidth={1.5} />
                <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-snc-text-secondary group-hover:text-snc-text-primary transition-colors">{mod.label}</span>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        <RevealOnScroll delay={0.4} className="text-center">
          <Link href="/login">
            <Button variant="ghostWhite" className="border-snc-electric/50 text-snc-electric hover:border-snc-electric hover:bg-snc-electric-ghost">
              THE TECHNOLOGY BEHIND SNC
            </Button>
          </Link>
        </RevealOnScroll>
      </div>
    </section>
  );
}
