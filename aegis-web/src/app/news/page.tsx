import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { ArticleCard } from "@/components/sections/ArticleCard";
import { getArticles } from "@/lib/api";

export const metadata = constructMetadata({
  title: "Newsroom | Six Nine Constructions",
  description: "Latest news, press releases, and project updates from SNC.",
});

export default async function NewsIndexPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams;
  const category = typeof searchParams.category === 'string' ? searchParams.category : undefined;
  
  const articlesRes = await getArticles({ limit: 12, category }).catch(() => null);
  const articles = articlesRes?.success ? articlesRes.data : [];

  return (
    <PageWrapper>
      <PageHero
        title="Newsroom"
        subtitle="Latest updates, corporate announcements, and project milestones."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Newsroom" }
        ]}
      />

      <section className="py-8 bg-[var(--snc-navy)] border-b border-[var(--snc-navy-border)] sticky top-[104px] z-30">
        <div className="container">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            {["All", "Press Release", "Project Update", "Company News", "Award", "Industry"].map((cat, i) => (
              <button 
                key={cat}
                className={`px-4 py-2 rounded-sm text-sm font-semibold tracking-wider uppercase whitespace-nowrap transition-colors ${
                  i === 0 
                    ? "bg-[var(--snc-gold)] text-[var(--snc-navy)]" 
                    : "border border-[var(--snc-navy-border)] text-[var(--snc-mist)] hover:border-[var(--snc-mist)]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-[var(--snc-void)] min-h-[50vh]">
        <div className="container">
          {articles.length > 0 ? (
            <>
              {articles[0] && (
                <div className="mb-12">
                  <ArticleCard article={articles[0]} variant="featured" className="min-h-[400px]" />
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {articles.slice(1).map(article => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            </>
          ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               <div className="lg:col-span-3 aspect-[3/1] bg-[var(--snc-navy-mid)] animate-pulse rounded-sm border border-[var(--snc-navy-border)] mb-6" />
               {[1,2,3].map(i => (
                 <div key={i} className="aspect-[4/3] bg-[var(--snc-navy-mid)] animate-pulse rounded-sm border border-[var(--snc-navy-border)]" />
               ))}
            </div>
          )}
        </div>
      </section>
    </PageWrapper>
  );
}
