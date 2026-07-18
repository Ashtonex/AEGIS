import { constructMetadata } from "@/lib/metadata";
import { PageWrapper } from "@/components/layout/PageWrapper";
import { PageHero } from "@/components/ui/PageHero";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Card } from "@/components/ui/Card";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { loadPageCMSContent } from "@/lib/cmsHelper";

export const metadata = constructMetadata({
  title: "Media Kit & Brand Assets | Six Nine Construction",
  description: "Six Nine Construction' media kit, high-resolution logos, brand guidelines, and official corporate bio resources.",
});

export default async function MediaKitPage() {
  const content = await loadPageCMSContent("media-kit", "hero", {
    title: "Official Media Kit.",
    subtitle: "Access official brand assets, corporate bios, high-resolution logotypes, and media guidelines for Six Nine Construction."
  });

  return (
    <PageWrapper>
      <PageHero
        variant="half"
        title={content.title}
        subtitle={content.subtitle}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Media Kit" }
        ]}
      />

      <section className="py-24 bg-snc-void border-b border-snc-border">
        <div className="container max-w-[1400px] mx-auto px-6 md:px-10 lg:px-16 xl:px-20">
          <div className="max-w-3xl mb-16">
            <SectionLabel>MEDIA ASSETS</SectionLabel>
            <h2 className="text-headline-lg text-white mt-2 font-display">Logos & Brand Guidelines</h2>
            <p className="text-body text-snc-text-secondary mt-6 leading-relaxed">
              These assets are provided for press, news publications, and project partners. Any modified use, scaling distortions, or recoloring of the SNC logotype is strictly prohibited.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card padding="standard" className="border-t-2 border-t-snc-gold-primary flex flex-col justify-between min-h-[220px]">
              <div>
                <ImageIcon className="w-8 h-8 text-snc-gold-primary mb-4" />
                <h4 className="text-lg font-bold text-white mb-2">Corporate Logo Pack</h4>
                <p className="text-sm text-snc-text-secondary">Official logo vectors in EPS, SVG, and high-resolution transparent PNG formats.</p>
              </div>
              <button className="flex items-center gap-2 text-xs font-mono tracking-wider text-snc-gold-primary uppercase mt-6 hover:text-white transition-colors duration-300">
                <Download className="w-4 h-4" />
                Download Pack (4.2 MB)
              </button>
            </Card>

            <Card padding="standard" className="border-t-2 border-t-snc-gold-primary flex flex-col justify-between min-h-[220px]">
              <div>
                <FileText className="w-8 h-8 text-snc-gold-primary mb-4" />
                <h4 className="text-lg font-bold text-white mb-2">Corporate Profile PDF</h4>
                <p className="text-sm text-snc-text-secondary">Official capability statement containing historical project details and executive team profiles.</p>
              </div>
              <button className="flex items-center gap-2 text-xs font-mono tracking-wider text-snc-gold-primary uppercase mt-6 hover:text-white transition-colors duration-300">
                <Download className="w-4 h-4" />
                Download PDF (8.7 MB)
              </button>
            </Card>

            <Card padding="standard" className="border-t-2 border-t-snc-gold-primary flex flex-col justify-between min-h-[220px]">
              <div>
                <FileText className="w-8 h-8 text-snc-gold-primary mb-4" />
                <h4 className="text-lg font-bold text-white mb-2">Brand Style Guide</h4>
                <p className="text-sm text-snc-text-secondary">Corporate colors (SNC Navy, Void, Gold, Electric), typography rules, and spacing guidelines.</p>
              </div>
              <button className="flex items-center gap-2 text-xs font-mono tracking-wider text-snc-gold-primary uppercase mt-6 hover:text-white transition-colors duration-300">
                <Download className="w-4 h-4" />
                Download Guide (2.1 MB)
              </button>
            </Card>
          </div>
        </div>
      </section>
    </PageWrapper>
  );
}
