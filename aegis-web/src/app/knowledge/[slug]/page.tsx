import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { Linkedin, Twitter, Link as LinkIcon, ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { getMockArticleBySlug } from "@/lib/mockArticles";
import { notFound } from "next/navigation";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const article = getMockArticleBySlug(params.slug);
  return constructMetadata({
    title: `${article ? article.title : 'Technical Guide'} | Six Nine Construction`,
    description: article?.excerpt,
  });
}

export default async function KnowledgeDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const article = getMockArticleBySlug(params.slug);

  if (!article) {
    notFound();
  }

  return (
    <PageWrapper>
      <article className="min-h-screen bg-[var(--snc-void)] pb-24">
        {/* Article Hero */}
        <div className="relative pt-[104px] border-b border-[var(--snc-navy-border)]">
          {article.featuredImage ? (
            <div className="absolute inset-0 z-0">
               <Image
                 src={article.featuredImage}
                 alt={article.title}
                 fill
                 priority
                 sizes="100vw"
                 className="w-full h-full object-cover"
               />
               <div className="absolute inset-0 bg-gradient-to-t from-[var(--snc-void)] to-[var(--snc-void)]/40" />
            </div>
          ) : (
            <div className="absolute inset-0 z-0 bg-[var(--snc-navy)]">
               <div className="absolute inset-0 bg-blueprint opacity-20" />
               <div className="absolute inset-0 bg-gradient-to-t from-[var(--snc-void)] to-transparent" />
            </div>
          )}
          
          <div className="container relative z-10 py-20 max-w-4xl">
            <Link href="/knowledge" className="inline-flex items-center gap-2 text-sm font-semibold tracking-wider uppercase text-[var(--snc-gold)] hover:text-[var(--snc-white)] transition-colors mb-12">
              <ArrowLeft className="w-4 h-4" /> Back to Knowledge Centre
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
