import { MetadataRoute } from 'next';
import { SITE_CONFIG } from '@/lib/constants';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_CONFIG.url;

  return [
    { url: baseUrl, lastModified: new Date() },
    { url: `${baseUrl}/about`, lastModified: new Date() },
    { url: `${baseUrl}/about/story`, lastModified: new Date() },
    { url: `${baseUrl}/about/leadership`, lastModified: new Date() },
    { url: `${baseUrl}/about/safety-hse`, lastModified: new Date() },
    { url: `${baseUrl}/about/sustainability`, lastModified: new Date() },
    { url: `${baseUrl}/capabilities`, lastModified: new Date() },
    { url: `${baseUrl}/industries`, lastModified: new Date() },
    { url: `${baseUrl}/projects`, lastModified: new Date() },
    { url: `${baseUrl}/tenders`, lastModified: new Date() },
    { url: `${baseUrl}/tenders/faq`, lastModified: new Date() },
    { url: `${baseUrl}/suppliers`, lastModified: new Date() },
    { url: `${baseUrl}/suppliers/register`, lastModified: new Date() },
    { url: `${baseUrl}/suppliers/guidelines`, lastModified: new Date() },
    { url: `${baseUrl}/careers`, lastModified: new Date() },
    { url: `${baseUrl}/news`, lastModified: new Date() },
    { url: `${baseUrl}/knowledge`, lastModified: new Date() },
    { url: `${baseUrl}/media-kit`, lastModified: new Date() },
    { url: `${baseUrl}/contact`, lastModified: new Date() },
    { url: `${baseUrl}/login`, lastModified: new Date() },
  ];
}
