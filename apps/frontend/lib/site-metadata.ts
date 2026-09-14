import type { Metadata } from "next";

export const PRODUCTION_ORIGIN = "https://story-poker.rake.lt";
export const SOCIAL_IMAGE_PATH = "/og";
export const POKER_TITLE = "Story Poker";
export const POKER_DESCRIPTION = "Create or join a planning room";
export const RETROSPECTIVE_TITLE = "Retrospective | Story Poker";
export const RETROSPECTIVE_DESCRIPTION =
  "Reflect together, choose priorities, and leave with clear actions. Rooms expire after two hours.";

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
    title: POKER_TITLE,
    description: "Create a planning room",
    ...createSocialMetadata(POKER_TITLE, POKER_DESCRIPTION, "/"),
  };
}

export function createRetrospectiveMetadata(path = "/retro"): Metadata {
  return {
    title: RETROSPECTIVE_TITLE,
    description: RETROSPECTIVE_DESCRIPTION,
    ...createSocialMetadata(
      RETROSPECTIVE_TITLE,
      RETROSPECTIVE_DESCRIPTION,
      path
    ),
  };
}

function createSocialMetadata(
  title: string,
  description: string,
  url: string
): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: POKER_TITLE,
      images: [{ url: SOCIAL_IMAGE_PATH }],
    },
    twitter: {
      title,
      description,
      card: "summary_large_image",
      images: [{ url: SOCIAL_IMAGE_PATH }],
    },
  };
}
