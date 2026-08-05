import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { ArticleCard } from "@/components/sections/ArticleCard";
import { getKnowledge } from "@/lib/api";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { NewsletterForm } from "@/components/forms/NewsletterForm";

export const metadata = constructMetadata({
  title: "Knowledge Centre | Six Nine Construction",
  description: "Engineering insights, technical papers, and industry reports from SNC.",
});

export default async function KnowledgePage() {
  const articlesRes = await getKnowledge({ limit: 12 }).catch(() => null);
  const articles = articlesRes?.success ? articlesRes.data : [];

  return (
    <PageWrapper>
      <PageHero
        title="Knowledge Centre"
        subtitle="Engineering insights, technical methodologies, and industry analysis from the SNC team."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Knowledge Centre" }
        ]}
      />

      <section className="py-24 bg-[var(--snc-void)]">
        <div className="container">
          
          {articles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-24">
               {articles.map(article => (
                 <ArticleCard key={article.id} article={article} basePath="/knowledge" />
               ))}
            </div>
          ) : (
            <div className="p-24 text-center border border-[var(--snc-navy-border)] bg-[var(--snc-navy-mid)] rounded-sm mb-24">
               <p className="text-[var(--snc-mist)]">Knowledge base content is currently being updated.</p>
            </div>
          )}

          <div className="p-12 border border-[var(--snc-gold)]/30 bg-[var(--snc-gold-ghost)] rounded-sm text-center max-w-4xl mx-auto cad-line-accent">
            <SectionLabel className="items-center mx-auto mb-6">Technical Briefing</SectionLabel>
            <h2 className="text-3xl font-display text-[var(--snc-white)] mb-4">Subscribe to SNC Insights</h2>
            <p className="text-[var(--snc-mist)] mb-8">Receive our quarterly technical briefings covering engineering innovations and infrastructure trends in Southern Africa.</p>
            <NewsletterForm />
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
