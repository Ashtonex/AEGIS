import { Metadata } from "next";
import { SITE_CONFIG } from "./constants";

export function constructMetadata({
  title = SITE_CONFIG.name,
  description = SITE_CONFIG.description,
  image = "/og-image.jpg", // default og image placeholder
  noIndex = false,
}: {
  title?: string;
  description?: string;
  image?: string;
  noIndex?: boolean;
} = {}): Metadata {
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: image,
        },
      ],
      siteName: SITE_CONFIG.name,
      locale: "en_ZW",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      creator: "@sixnineconstructions",
    },
    // public/ has no favicon.ico - pointing at it 404'd on every page load.
    icons: {
      icon: "/logo.png",
    },
    metadataBase: new URL(SITE_CONFIG.url),
    ...(noIndex && {
      robots: {
        index: false,
        follow: false,
      },
    }),
  };
}
