import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { Linkedin, Twitter, Link as LinkIcon, ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { getArticleBySlug } from "@/lib/api";
import { notFound } from "next/navigation";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const response = await getArticleBySlug(params.slug).catch(() => null);
  const article = response?.success ? response.data : null;
  return constructMetadata({
    title: `${article ? article.title : 'News Article'} | Six Nine Construction`,
    description: article?.excerpt,
  });
}

export default async function ArticleDetailPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const response = await getArticleBySlug(params.slug).catch(() => null);
  const article = response?.success ? response.data : null;

  if (!article) {
    notFound();
  }

  return (
    <PageWrapper>
      <article className="min-h-screen bg-[var(--dxl-void)] pb-24">
        {/* Article Hero */}
        <div className="relative pt-[104px] border-b border-[var(--dxl-ink-mid)]">
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
               <div className="absolute inset-0 bg-gradient-to-t from-[var(--dxl-void)] to-[var(--dxl-void)]/40" />
            </div>
          ) : (
            <div className="absolute inset-0 z-0 bg-[var(--dxl-ink)]">
               <div className="absolute inset-0 bg-blueprint opacity-20" />
               <div className="absolute inset-0 bg-gradient-to-t from-[var(--dxl-void)] to-transparent" />
            </div>
          )}
          
          <div className="container relative z-10 py-20 max-w-4xl">
            <Link href="/news" className="inline-flex items-center gap-2 text-sm font-semibold tracking-wider uppercase text-[var(--dxl-signal)] hover:text-[var(--dxl-paper)] transition-colors mb-12">
              <ArrowLeft className="w-4 h-4" /> Back to Newsroom
            </Link>
            
            <div className="flex items-center gap-4 mb-6">
              <Badge variant="gold">{article.category}</Badge>
              <span className="text-[var(--dxl-slate-light)] text-sm">{formatDate(article.publishDate)}</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display text-[var(--dxl-paper)] mb-8 tracking-tight">
              {article.title}
            </h1>
            
            {article.author && (
              <div className="text-sm uppercase tracking-widest text-[var(--dxl-slate)]">
                By <span className="text-[var(--dxl-slate-light)]">{article.author}</span>
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
                <button className="w-10 h-10 rounded-full border border-[var(--dxl-ink-mid)] bg-[var(--dxl-ink-light)] flex items-center justify-center text-[var(--dxl-slate-light)] hover:text-[var(--dxl-signal)] hover:border-[var(--dxl-signal)] transition-all">
                  <Linkedin className="w-4 h-4" />
                </button>
                <button className="w-10 h-10 rounded-full border border-[var(--dxl-ink-mid)] bg-[var(--dxl-ink-light)] flex items-center justify-center text-[var(--dxl-slate-light)] hover:text-[var(--dxl-signal)] hover:border-[var(--dxl-signal)] transition-all">
                  <Twitter className="w-4 h-4" />
                </button>
                <button className="w-10 h-10 rounded-full border border-[var(--dxl-ink-mid)] bg-[var(--dxl-ink-light)] flex items-center justify-center text-[var(--dxl-slate-light)] hover:text-[var(--dxl-signal)] hover:border-[var(--dxl-signal)] transition-all">
                  <LinkIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="lg:col-span-11">
              <div 
                className="prose prose-invert prose-lg max-w-none prose-headings:font-display prose-headings:tracking-wide prose-headings:text-[var(--dxl-paper)] prose-p:text-[var(--dxl-slate-light)] prose-a:text-[var(--dxl-signal)] hover:prose-a:text-[var(--dxl-signal-hover)]"
                dangerouslySetInnerHTML={{ __html: article.content }}
              />
            </div>
          </div>
        </div>
      </article>
    </PageWrapper>
  );
}
