import { getPublicWebsiteContent } from "./api";

export interface WebsiteContentItem {
  page_key: string;
  section_key: string;
  title: string;
  subtitle: string;
  body: string;
  status: string;
  metadata: any;
}

export async function loadPageCMSContent(
  pageKey: string,
  sectionKey: string,
  defaults: { title: string; subtitle: string; body?: string }
) {
  try {
    const res = await getPublicWebsiteContent();
    if (res.success && Array.isArray(res.data)) {
      const match = res.data.find(
        (item: any) => item.page_key === pageKey && item.section_key === sectionKey
      );
      if (match) {
        return {
          title: match.title || defaults.title,
          subtitle: match.subtitle || defaults.subtitle,
          body: match.body || defaults.body || ""
        };
      }
    }
  } catch (err) {
    // Silent fallback to defaults
  }
  return defaults;
}
