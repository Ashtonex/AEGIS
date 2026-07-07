import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { Linkedin, Twitter, Link as LinkIcon, ArrowLeft } from "lucide-react";
import Link from "next/link";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  // Mock metadata logic for demonstration
  return constructMetadata({
    title: `News Article | Six Nine Constructions`,
  });
}

export default async function ArticleDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  // Mock article
  const article = {
    title: "SNC Awarded Phase 2 of Platinum Processing Plant Expansion",
    category: "Project Update",
    publishDate: "2025-06-15T00:00:00Z",
    author: "Corporate Communications",
    featuredImage: "", // Mock
    content: `
      <p class="lead">Six Nine Constructions (SNC) is pleased to announce the successful award of the Phase 2 expansion contract for the Global Platinum Resources processing plant in the Midlands Province.</p>
      
      <p>Following the successful, early completion of Phase 1, SNC has been retained as the principal contractor for the $45M expansion phase. The scope of work encompasses major civil works, structural steel erection, and the installation of secondary milling circuits.</p>
      
      <h3>Engineering Complexity</h3>
      <p>The primary challenge of Phase 2 involves executing deep foundation works adjacent to the live Phase 1 plant without disrupting ongoing operations. SNC will leverage its proprietary digital command center, Project AEGIS, to synchronize construction activities with the plant's operational schedule.</p>
      
      <p>"This award validates our engineering-led approach to construction," stated the Managing Director of SNC. "Our ability to provide absolute transparency through AEGIS, combined with our rigorous safety standards, makes us the partner of choice for complex brownfield expansions."</p>
      
      <h3>Timeline and Mobilization</h3>
      <p>Site mobilization is scheduled for Q3 2025, with an anticipated practical completion date of Q4 2026. The project is expected to create over 300 jobs during the peak construction phase, aligning with SNC's commitment to local skills development.</p>
    `
  };

  return (
    <PageWrapper>
      <article className="min-h-screen bg-[var(--snc-void)] pb-24">
        {/* Article Hero */}
        <div className="relative pt-[104px] border-b border-[var(--snc-navy-border)]">
          {article.featuredImage ? (
            <div className="absolute inset-0 z-0">
               <img src={article.featuredImage} alt={article.title} className="w-full h-full object-cover" />
               <div className="absolute inset-0 bg-gradient-to-t from-[var(--snc-void)] to-[var(--snc-void)]/40" />
            </div>
          ) : (
            <div className="absolute inset-0 z-0 bg-[var(--snc-navy)]">
               <div className="absolute inset-0 bg-blueprint opacity-20" />
               <div className="absolute inset-0 bg-gradient-to-t from-[var(--snc-void)] to-transparent" />
            </div>
          )}
          
          <div className="container relative z-10 py-20 max-w-4xl">
            <Link href="/news" className="inline-flex items-center gap-2 text-sm font-semibold tracking-wider uppercase text-[var(--snc-gold)] hover:text-[var(--snc-white)] transition-colors mb-12">
              <ArrowLeft className="w-4 h-4" /> Back to Newsroom
            </Link>
            
            <div className="flex items-center gap-4 mb-6">
              <Badge variant="gold">{article.category}</Badge>
              <span className="text-[var(--snc-mist)] text-sm">{formatDate(article.publishDate)}</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display text-[var(--snc-white)] mb-8 tracking-tight">
              {article.title}
            </h1>
            
            {article.author && (
              <div className="text-sm uppercase tracking-widest text-[var(--snc-grey)]">
                By <span className="text-[var(--snc-mist)]">{article.author}</span>
              </div>
            )}
          </div>
        </div>

        {/* Article Body */}
        <div className="container max-w-4xl pt-16">
          <div className="grid lg:grid-cols-12 gap-12">
            
            {/* Share Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-32 flex flex-row lg:flex-col gap-4">
                <button className="w-10 h-10 rounded-full border border-[var(--snc-navy-border)] bg-[var(--snc-navy-raised)] flex items-center justify-center text-[var(--snc-mist)] hover:text-[var(--snc-gold)] hover:border-[var(--snc-gold)] transition-all">
                  <Linkedin className="w-4 h-4" />
                </button>
                <button className="w-10 h-10 rounded-full border border-[var(--snc-navy-border)] bg-[var(--snc-navy-raised)] flex items-center justify-center text-[var(--snc-mist)] hover:text-[var(--snc-gold)] hover:border-[var(--snc-gold)] transition-all">
                  <Twitter className="w-4 h-4" />
                </button>
                <button className="w-10 h-10 rounded-full border border-[var(--snc-navy-border)] bg-[var(--snc-navy-raised)] flex items-center justify-center text-[var(--snc-mist)] hover:text-[var(--snc-gold)] hover:border-[var(--snc-gold)] transition-all">
                  <LinkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="lg:col-span-11">
              <div 
                className="prose prose-invert prose-lg max-w-none prose-headings:font-display prose-headings:tracking-wide prose-headings:text-[var(--snc-white)] prose-p:text-[var(--snc-mist)] prose-a:text-[var(--snc-gold)] hover:prose-a:text-[var(--snc-gold-bright)]"
                dangerouslySetInnerHTML={{ __html: article.content }}
              />
            </div>
          </div>
        </div>
      </article>
    </PageWrapper>
  );
}
