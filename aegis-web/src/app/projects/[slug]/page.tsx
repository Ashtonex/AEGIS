import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { getProject, getProjects } from "@/lib/api";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Timeline } from "@/components/ui/Timeline";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { formatCurrency } from "@/lib/utils";
import { Calendar, MapPin, Building2, HardHat } from "lucide-react";
import Image from "next/image";

import { populateProjectGalleries } from "@/lib/projectsHelper";
import ProjectDetailsTabs from "./ProjectDetailsTabs";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const res = await getProject(params.slug).catch(() => null);
  if (!res?.success || !res.data) return {};
  
  return constructMetadata({
    title: `${res.data.title} | Projects | Six Nine Construction`,
    description: res.data.description,
  });
}

export default async function ProjectDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const res = await getProject(params.slug).catch(() => null);
  if (!res?.success || !res.data) {
    notFound();
  }

  const project = populateProjectGalleries(res.data);

  return (
    <PageWrapper>
      {/* 1. Hero */}
      <section className="relative min-h-[70vh] flex flex-col justify-end border-b border-[var(--snc-navy-border)] -mt-[104px] pt-[104px]">
        <div className="absolute inset-0 z-0 bg-[var(--snc-navy)]">
          {project.featuredImage ? (
            <Image
              src={project.featuredImage}
              alt={project.title}
              fill
              priority
              sizes="100vw"
              quality={90}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-blueprint opacity-20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--snc-void)] via-[var(--snc-void)]/80 to-transparent" />
        </div>

        <div className="container relative z-10 pb-16">
          <Breadcrumb 
            items={[
              { label: "Home", href: "/" },
              { label: "Projects", href: "/projects" },
              { label: project.title }
            ]}
            className="mb-8"
          />
          
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <Badge variant="gold">{project.category}</Badge>
            <Badge variant={project.status === 'Completed' ? 'green' : 'blue'}>{project.status}</Badge>
          </div>
          
          <h1 className="text-display mb-6 tracking-tight text-[var(--snc-white)] max-w-4xl">
            {project.title}
          </h1>

          <div className="flex flex-wrap gap-8 text-[var(--snc-mist)] font-medium">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-[var(--snc-gold)]" />
              {project.province}
            </div>
            {project.value && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--snc-gold)]">$</span>
                {formatCurrency(project.value)}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Project Overview */}
      <section className="py-16 bg-[var(--snc-void)] border-b border-[var(--snc-navy-border)]">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
             <div>
               <div className="text-xs uppercase tracking-widest text-[var(--snc-grey)] mb-2">Client</div>
               <div className="font-semibold text-[var(--snc-white)]">{project.client}</div>
             </div>
             <div>
               <div className="text-xs uppercase tracking-widest text-[var(--snc-grey)] mb-2">Contract Type</div>
               <div className="font-semibold text-[var(--snc-white)]">{project.contractType}</div>
             </div>
             <div>
               <div className="text-xs uppercase tracking-widest text-[var(--snc-grey)] mb-2">Timeline</div>
               <div className="font-semibold text-[var(--snc-white)]">
                 {new Date(project.timeline.start).getFullYear()} {project.timeline.end ? `- ${new Date(project.timeline.end).getFullYear()}` : '- Present'}
               </div>
             </div>
             <div>
               <div className="text-xs uppercase tracking-widest text-[var(--snc-grey)] mb-2">Industry</div>
               <div className="font-semibold text-[var(--snc-white)]">{project.industry}</div>
             </div>
          </div>
        </div>
      </section>

      {/* 3. Tabbed Case Study Sections & Operational Galleries */}
      <section className="py-24 bg-[var(--snc-navy)]">
        <ProjectDetailsTabs project={project} />
      </section>

    </PageWrapper>
  );
}
