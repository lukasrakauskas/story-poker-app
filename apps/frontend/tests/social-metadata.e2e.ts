import { expect, test, type Page } from "@playwright/test";

async function expectSocialMetadata(
  page: Page,
  expected: { title: string; description: string; url: string }
) {
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    expected.title
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    expected.description
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    expected.url
  );
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
    "content",
    expected.title
  );
  await expect(
    page.locator('meta[name="twitter:description"]')
  ).toHaveAttribute("content", expected.description);
}

test("Poker and retrospective pages publish route-specific social metadata", async ({
  page,
}) => {
  await page.goto("/");
  await expectSocialMetadata(page, {
    title: "Story Poker",
    description: "Create or join a planning room",
    url: "http://localhost:3001",
  });

  const retrospective = {
    title: "Retrospective | Story Poker",
    description:
      "Reflect together, choose priorities, and leave with clear actions. Rooms expire after two hours.",
  };
  await page.goto("/retro");
  await expectSocialMetadata(page, {
    ...retrospective,
    url: "http://localhost:3001/retro",
  });

  await page.goto("/retro/sprint-42");
  await expectSocialMetadata(page, {
    ...retrospective,
    url: "http://localhost:3001/retro/sprint-42",
  });
});
