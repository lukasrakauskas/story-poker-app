import { expect, test } from "@playwright/test";

async function expectLegalLinks(page: import("@playwright/test").Page) {
  await expect(
    page.getByRole("link", { name: "Terms of Service", exact: true })
  ).toHaveAttribute("href", "/terms");
  await expect(
    page.getByRole("link", { name: "Privacy Policy", exact: true })
  ).toHaveAttribute("href", "/privacy");
}

test("legal links open dedicated pages from create and join forms", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expectLegalLinks(page);

  await page
    .getByRole("link", { name: "Terms of Service", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Terms of Service", exact: true })
  ).toBeVisible();
  await expect(page).toHaveTitle("Terms of Service | Story Poker");
  await expect(
    page.getByRole("button", { name: "Join room", exact: true })
  ).toHaveCount(0);

  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy Policy", exact: true })
  ).toBeVisible();
  await expect(page).toHaveTitle("Privacy Policy | Story Poker");
  await expect(
    page.getByRole("button", { name: "Join room", exact: true })
  ).toHaveCount(0);

  await page.goto("/");
  await page.getByLabel("Name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your estimate", exact: true })
  ).toBeVisible();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(page.url());
    await expect(
      guest.getByRole("button", { name: "Join room", exact: true })
    ).toBeVisible();
    await expectLegalLinks(guest);
  } finally {
    await guestContext.close();
  }
});
