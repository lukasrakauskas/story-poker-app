import assert from "node:assert/strict";
import test from "node:test";
import type { Metadata } from "next";
import {
  createRetrospectiveMetadata,
  createRootMetadata,
  getSiteOrigin,
  POKER_DESCRIPTION,
  POKER_TITLE,
  PRODUCTION_ORIGIN,
  RETROSPECTIVE_DESCRIPTION,
  RETROSPECTIVE_TITLE,
  SOCIAL_IMAGE_PATH,
} from "../lib/site-metadata";

function imageUrl(image: unknown) {
  const first = Array.isArray(image) ? image[0] : image;
  if (typeof first === "string") return first;
  if (first instanceof URL) return first.href;
  if (first && typeof first === "object" && "url" in first) {
    const url = first.url;
    return url instanceof URL ? url.href : String(url);
  }
  throw new Error("Metadata does not contain a social image");
}

function socialImageUrls(metadata: Metadata) {
  assert.ok(metadata.metadataBase);
  assert.ok(metadata.openGraph && "images" in metadata.openGraph);
  assert.ok(metadata.twitter && "images" in metadata.twitter);
  return [metadata.openGraph.images, metadata.twitter.images].map(
    (images) => new URL(imageUrl(images), metadata.metadataBase!).href
  );
}

function socialMetadata(metadata: Metadata, metadataBase: URL) {
  assert.ok(metadata.openGraph);
  assert.ok(metadata.twitter);
  const openGraphUrl = metadata.openGraph.url;
  assert.ok(typeof openGraphUrl === "string" || openGraphUrl instanceof URL);
  return {
    openGraphTitle: metadata.openGraph.title,
    openGraphDescription: metadata.openGraph.description,
    openGraphUrl: new URL(openGraphUrl, metadataBase).href,
    twitterTitle: metadata.twitter.title,
    twitterDescription: metadata.twitter.description,
  };
}

test("production metadata resolves every social image against the public origin", () => {
  const origin = getSiteOrigin({
    NODE_ENV: "production",
    PORT: undefined,
    SITE_ORIGIN: undefined,
  });
  const metadata = createRootMetadata(origin);
  const expectedImage = `${PRODUCTION_ORIGIN}${SOCIAL_IMAGE_PATH}`;

  assert.equal(origin.href, `${PRODUCTION_ORIGIN}/`);
  assert.deepEqual(socialImageUrls(metadata), [expectedImage, expectedImage]);
  for (const image of socialImageUrls(metadata)) {
    assert.doesNotMatch(image, /localhost/);
  }
});

test("poker and retrospective entry metadata stay route-specific", () => {
  const origin = new URL(PRODUCTION_ORIGIN);
  assert.deepEqual(socialMetadata(createRootMetadata(origin), origin), {
    openGraphTitle: POKER_TITLE,
    openGraphDescription: POKER_DESCRIPTION,
    openGraphUrl: `${PRODUCTION_ORIGIN}/`,
    twitterTitle: POKER_TITLE,
    twitterDescription: POKER_DESCRIPTION,
  });
  assert.deepEqual(socialMetadata(createRetrospectiveMetadata(), origin), {
    openGraphTitle: RETROSPECTIVE_TITLE,
    openGraphDescription: RETROSPECTIVE_DESCRIPTION,
    openGraphUrl: `${PRODUCTION_ORIGIN}/retro`,
    twitterTitle: RETROSPECTIVE_TITLE,
    twitterDescription: RETROSPECTIVE_DESCRIPTION,
  });
  assert.equal(
    socialMetadata(createRetrospectiveMetadata("/retro/sprint-42"), origin)
      .openGraphUrl,
    `${PRODUCTION_ORIGIN}/retro/sprint-42`
  );
});

test("development and explicit metadata origins are resolved safely", () => {
  const local = getSiteOrigin({
    NODE_ENV: "development",
    PORT: "3001",
    SITE_ORIGIN: undefined,
  });
  assert.deepEqual(socialImageUrls(createRootMetadata(local)), [
    "http://localhost:3001/og",
    "http://localhost:3001/og",
  ]);

  assert.equal(
    getSiteOrigin({
      NODE_ENV: "production",
      PORT: undefined,
      SITE_ORIGIN: "https://preview.example.com/path?ignored=yes",
    }).href,
    "https://preview.example.com/"
  );
  assert.throws(() =>
    getSiteOrigin({
      NODE_ENV: "production",
      PORT: undefined,
      SITE_ORIGIN: "javascript:alert(1)",
    })
  );
});
