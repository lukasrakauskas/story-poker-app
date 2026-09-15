import { test, expect } from "@playwright/test";
import { chooseRecoveryHistory } from "./retro-history-test-helpers";

test("mobile discussion actions preserve context, scroll and focus beside a long priority list", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/retro");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByLabel("Retrospective title").fill("Long discussion");
  await page
    .getByRole("button", { name: "Create retrospective", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Long discussion", exact: true })
  ).toBeVisible();
  await chooseRecoveryHistory(page);
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guest = await guestContext.newPage();
  await guest.goto(page.url());
  await guest.getByLabel("Your name").fill("Bobby");
  await guest
    .getByRole("button", { name: "Join retrospective", exact: true })
    .click();
  await chooseRecoveryHistory(guest);
  for (let i = 1; i <= 18; i++) {
    await page
      .getByLabel("Add a note", { exact: true })
      .first()
      .fill(
        `Discussion topic ${i}: keep enough context to discuss a concrete next step.`
      );
    await page
      .getByRole("button", { name: "Add to went well", exact: true })
      .click();
    await expect(
      page.getByText(
        `Discussion topic ${i}: keep enough context to discuss a concrete next step.`,
        { exact: true }
      )
    ).toBeVisible();
  }
  for (const label of [
    "Reveal and group notes",
    "Start voting",
    "Start discussion",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page
      .getByRole("button", {
        name: `Confirm ${label.toLowerCase()}`,
        exact: true,
      })
      .click();
  }
  await page
    .getByRole("region", { name: "Discussion priorities" })
    .locator("article")
    .nth(12)
    .scrollIntoViewIfNeeded();
  const position = await page
    .locator("#app-content")
    .evaluate((element) => element.scrollTop);
  expect(position).toBeGreaterThan(1000);
  const trigger = page.getByRole("button", { name: /^Action items ·/ });
  const triggerBox = (await trigger.boundingBox())!;
  expect(triggerBox.y).toBeGreaterThanOrEqual(0);
  expect(triggerBox.y + triggerBox.height).toBeLessThan(844);
  await trigger.click();
  const sheet = page.getByRole("dialog", {
    name: "Discussion actions",
    exact: true,
  });
  await sheet
    .getByLabel("Next step", { exact: true })
    .fill("Keep discussion context");
  await sheet.getByRole("button", { name: "Add action", exact: true }).click();
  await sheet
    .getByRole("checkbox", {
      name: "Mark action complete: Keep discussion context",
      exact: true,
    })
    .click();
  await expect(
    sheet.getByRole("checkbox", {
      name: "Mark action incomplete: Keep discussion context",
      exact: true,
    })
  ).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(
    Math.abs(
      (await page
        .locator("#app-content")
        .evaluate((element) => element.scrollTop)) - position
    )
  ).toBeLessThan(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await guest
    .getByRole("button", { name: /^Action items · 1 \(1 done\)/ })
    .click();
  const guestSheet = guest.getByRole("dialog", {
    name: "Discussion actions",
    exact: true,
  });
  await expect(
    guestSheet.getByText("Keep discussion context", { exact: true })
  ).toBeVisible();
  await expect(guestSheet.getByText("Done", { exact: true })).toBeVisible();
  await expect(guestSheet.getByRole("form")).toHaveCount(0);
  await guestSheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: /^Action items ·/ })
  ).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(trigger).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "New action", exact: true })
  ).toBeVisible();
  const actionsBox = (await page
    .getByRole("form", { name: "New action", exact: true })
    .boundingBox())!;
  const notesBox = (await page
    .getByRole("region", { name: "Discussion priorities" })
    .boundingBox())!;
  expect(actionsBox.x).toBeGreaterThan(notesBox.x + notesBox.width);
  await guestContext.close();
});
