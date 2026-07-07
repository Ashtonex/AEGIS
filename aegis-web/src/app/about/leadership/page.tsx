import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { LeadershipCard } from "@/components/sections/LeadershipCard";
import { getLeadership } from "@/lib/api";

export const metadata = constructMetadata({
  title: "Leadership | Six Nine Constructions",
  description: "Meet the executive team driving Six Nine Constructions.",
});

export default async function LeadershipPage() {
  const leadershipRes = await getLeadership().catch(() => null);
  const profiles = leadershipRes?.success ? leadershipRes.data : [];

  return (
    <PageWrapper>
      <PageHero
        title="Leadership"
        subtitle="The executive and operational minds behind our infrastructure delivery."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Company", href: "/about" },
          { label: "Leadership" }
        ]}
      />

      <section className="py-24 bg-[var(--snc-void)] min-h-[50vh]">
        <div className="container">
          
          {/* Filters placeholder - in a real app this would be a client component */}
          <div className="flex flex-wrap gap-2 mb-12">
            {["All", "Executive", "Engineering", "Commercial", "Operations", "Finance"].map((dept, i) => (
              <button 
                key={dept}
                className={`px-4 py-2 rounded-sm text-sm font-semibold tracking-wider uppercase transition-colors ${
                  i === 0 
                    ? "bg-[var(--snc-gold)] text-[var(--snc-navy)]" 
                    : "border border-[var(--snc-navy-border)] text-[var(--snc-mist)] hover:border-[var(--snc-mist)]"
                }`}
              >
                {dept}
              </button>
            ))}
          </div>

          {profiles.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {profiles.map(profile => (
                <LeadershipCard key={profile.id} profile={profile} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
               {[1,2,3,4,5,6,7,8].map(i => (
                 <div key={i} className="aspect-[3/4] bg-[var(--snc-navy-mid)] animate-pulse rounded-sm border border-[var(--snc-navy-border)]" />
               ))}
            </div>
          )}

        </div>
      </section>
    </PageWrapper>
  );
}
