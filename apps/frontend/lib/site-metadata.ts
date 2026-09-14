import type { Metadata } from "next";

export const PRODUCTION_ORIGIN = "https://story-poker.rake.lt";
export const SOCIAL_IMAGE_PATH = "/og";

type SiteEnvironment = {
  NODE_ENV?: string;
  PORT?: string;
  SITE_ORIGIN?: string;
};

export function getSiteOrigin(environment: SiteEnvironment = process.env) {
  const configuredOrigin = environment.SITE_ORIGIN?.trim();
  if (configuredOrigin) {
    const url = new URL(configuredOrigin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "SITE_ORIGIN must be an HTTP(S) origin without credentials"
      );
    }
    return new URL(url.origin);
  }

  if (environment.NODE_ENV === "production") {
    return new URL(PRODUCTION_ORIGIN);
  }

  const port = /^\d+$/.test(environment.PORT ?? "") ? environment.PORT : "3000";
  return new URL(`http://localhost:${port}`);
}

export function createRootMetadata(metadataBase: URL): Metadata {
  return {
    metadataBase,
    title: "Story Poker",
    description: "Create a planning room",
    openGraph: {
      type: "website",
      url: "/",
      title: "Story Poker",
      description: "Create or join a planning room",
      siteName: "Story Poker",
      images: [{ url: SOCIAL_IMAGE_PATH }],
    },
    twitter: {
      title: "Story Poker",
      description: "Create or join a planning room",
      card: "summary_large_image",
      images: [{ url: SOCIAL_IMAGE_PATH }],
    },
  };
}
